"""The efficacy and safety lanes.

Each lane is gather (code) -> extract (one model call) -> gate (code) -> score (formulas):
the model only reads and writes claims; every number comes from a function.
"""

from typing import Any, get_args

import yaml
from pydantic import Field

from app.contracts import (
    AssessedCause,
    Claim,
    NodeSpec,
    RiskAdjustment,
    TranslationLink,
)
from app.contracts.claims import TranslationStatus, TranslationStep
from app.contracts.ids import claim_id
from app.core.settings import get_settings
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.graph.topology import LANES, lane_container, lane_node
from app.nodes._analysis import (
    DIGEST_CHARS,
    OUT_TOKENS,
    QUOTE_MISSING,
    Draft,
    DraftClaim,
    ask_fitted,
    describe_program,
    digest,
    dump_drafts,
    fixture_run,
    gate,
    instructions,
    load_drafts,
    system_prompt,
    tally,
    to_claims,
    usable_evidence,
)
from app.nodes._data import entity_ids
from app.nodes._fixture import excluded_ids, fixture_report, nap, slug, touch_llm
from app.nodes.base import NodeContext, NodeRun
from app.nodes.subgraphs.bull_bear import rank_hits
from app.quant.assessment import (
    EfficacyInputs,
    SafetyInputs,
    infer_modality,
    score_efficacy,
    score_safety,
)

TRANSLATION_STEPS: tuple[str, ...] = get_args(TranslationStep)
_GOAL: dict[str, str] = {
    "efficacy": "whether the drug does what it is meant to do in people",
    "safety": "whether people will tolerate the drug",
}
# the failure causes each lane speaks to (pk_exposure rides with efficacy: it is the exposure link)
_CAUSES: dict[str, tuple[str, ...]] = {
    "efficacy": ("efficacy", "pk_exposure"),
    "safety": ("safety",),
}
_QUERIES: dict[str, tuple[str, ...]] = {
    "efficacy": (
        "{subject} {disease} efficacy clinical trial results",
        "{subject} genetic association {disease}",
        "{subject} target engagement biomarker",
        "{subject} exposure pharmacokinetics tissue penetration",
        "{subject} preclinical animal model results",
        "{subject} {disease} phase 2 primary endpoint",
    ),
    "safety": (
        "{subject} safety liability toxicity",
        "{subject} adverse reactions boxed warning warnings",
        "{subject} stopped safety adverse events",
        "{subject} tissue expression off-target",
    ),
}


def container_spec(lane: AssessedCause) -> NodeSpec:
    writes = ["claims", "risk_adjustments", "assessments", "scratch"]
    if lane == "efficacy":
        writes.append("translation_chain")
    return NodeSpec(
        id=lane_container(lane),
        label=f"{lane.capitalize()} assessment",
        kind=lane,
        phase="assess",
        description=f"Checks {_GOAL[lane]}: gathers the biology and the precedent, extracts what the evidence says, then scores it with formulas.",
        reads=["program", "entities", "questions", "evidence_ids", "twin_stats"],
        writes=writes,
    )


def _specs(lane: AssessedCause) -> list[NodeSpec]:
    parent = lane_container(lane)
    label = lane.capitalize()
    gather = {
        "efficacy": "Collects what bears on efficacy from the frozen evidence and the precedent base: association evidence by data type, same-target trial outcomes, class history and your preclinical data. No model.",
        "safety": "Collects target safety liabilities, tissue expression, label warnings, class adverse events and safety-tagged stop reasons from the frozen evidence and the precedent base. No model.",
    }[lane]
    extract = {
        "efficacy": "Fills the five-step translation chain and drafts efficacy claims from the gathered material, each citing evidence ids.",
        "safety": "Names the liabilities (organ, on or off target, severity) and drafts safety claims and risk candidates, each citing evidence ids.",
    }[lane]
    score = {
        "efficacy": "Turns the gathered numbers and the accepted claims into risk adjustments for the efficacy and exposure hazards, by formula.",
        "safety": "Turns liabilities, adverse-event signals, tissue selectivity and precedent into risk adjustments for the safety hazard, by formula.",
    }[lane]
    gate_writes = ["claims", "translation_chain"] if lane == "efficacy" else ["claims"]
    return [
        NodeSpec(
            id=lane_node(lane, "gather"),
            label=f"{label} gatherer",
            kind="knowledge",
            phase="assess",
            description=gather,
            reads=["program", "entities", "evidence_ids", "twin_stats"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=lane_node(lane, "extract"),
            label=f"{label} extractor",
            kind="analysis",
            phase="assess",
            description=extract,
            reads=["program", "entities", "scratch"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=lane_node(lane, "gate"),
            label=f"{label} claim gate",
            kind="processing",
            phase="assess",
            description="Rejects or downgrades drafted claims whose evidence ids are not valid"
            + (" and settles the translation chain." if lane == "efficacy" else "."),
            reads=["evidence_ids", "scratch"],
            writes=gate_writes,
            parent=parent,
        ),
        NodeSpec(
            id=lane_node(lane, "score"),
            label=f"{label} scorer",
            kind="quant",
            phase="assess",
            description=score,
            reads=["claims", "twin_stats", "scratch"],
            writes=["risk_adjustments", "assessments"],
            parent=parent,
        ),
    ]


SPECS: list[NodeSpec] = [spec for lane in LANES for spec in _specs(lane)]


class _ChainStep(Draft):
    step: TranslationStep
    status: TranslationStatus
    claims: list[int] = Field(default_factory=list, description="0-based indexes into claims.")


class EfficacyDraft(Draft):
    claims: list[DraftClaim] = Field(default_factory=list)
    chain: list[_ChainStep] = Field(default_factory=list)


class SafetyDraft(Draft):
    claims: list[DraftClaim] = Field(default_factory=list)


def _ledger_conf() -> dict[str, Any]:
    return yaml.safe_load((get_settings().config_dir / "ledger.yaml").read_text())


def _scratch(state: GraphState, node_id: str) -> dict[str, Any]:
    return state.get("scratch", {}).get(node_id, {})


def _lane_ids(lane: AssessedCause, state: GraphState) -> list[str]:
    """Evidence ids the fetch nodes flagged as this lane's inputs; the program's own data first."""
    own = list(_scratch(state, "ingest_user_input").get("program_evidence_ids", []))
    if lane == "efficacy":
        return own + list(_scratch(state, "fetch_opentargets").get("association_evidence_ids", []))
    facts = _scratch(state, "fetch_safety")
    ids = own + list(facts.get("liability_evidence_ids", []))
    ids += [i for v in facts.get("boxed_warning_evidence_ids", {}).values() for i in v]
    ids += [i for v in facts.get("faers", {}).values() for i in v]
    ids += [i for v in facts.get("labels", {}).values() for i in v]
    return ids


def chain_from_draft(
    drafted: EfficacyDraft, claim_ids_by_index: list[str | None]
) -> list[TranslationLink]:
    given = {}
    for s in drafted.chain:
        ids = [
            claim_ids_by_index[i]
            for i in s.claims
            if 0 <= i < len(claim_ids_by_index) and claim_ids_by_index[i]
        ]
        given.setdefault(s.step, TranslationLink(step=s.step, status=s.status, claim_ids=ids))  # type: ignore[arg-type]
    return [
        given.get(step) or TranslationLink(step=step, status="missing")
        for step in TRANSLATION_STEPS
    ]  # type: ignore[arg-type]


def settle_chain(chain: list[TranslationLink], gated: dict[str, Claim]) -> list[TranslationLink]:
    """A step keeps its status only while a claim behind it survives the gate; a step resting only
    on claims whose quote failed drops from supported to weak."""
    settled = []
    for link in chain:
        alive = [c for c in link.claim_ids if c in gated and gated[c].status != "rejected"]
        status = link.status
        if status != "missing" and not alive:
            status = "missing"
        elif status == "supported" and all(
            gated[c].rejection_reason == QUOTE_MISSING for c in alive
        ):
            status = "weak"
        settled.append(link.model_copy(update={"status": status, "claim_ids": alive}))
    return settled


def make_nodes(lane: AssessedCause) -> dict[str, NodeRun]:
    gather, extract, gate_id, score = (
        lane_node(lane, s) for s in ("gather", "extract", "gate", "score")
    )

    async def run_gather(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        if fixture_run(state):
            return await _fixture_gather(state, ctx)
        program, entities = state["program"], state.get("entities")
        subject = (
            " ".join(
                x
                for x in (
                    entities.target.label if entities and entities.target else None,
                    entities.drug.label if entities and entities.drug else program.drug_name,
                )
                if x
            )
            or program.mechanism
        )
        disease = entities.disease.label if entities else program.indication
        ids, k = entity_ids(entities), ctx.effort.retrieval_k
        hits = [
            [
                e.id
                for e in await ctx.retriever.retrieve(
                    q.format(subject=subject, disease=disease), ids, None, k
                )
            ]
            for q in _QUERIES[lane]
        ]
        valid = usable_evidence(state)
        flagged = [i for i in _lane_ids(lane, state) if i in valid]
        cap = max(12, 3 * k)
        found = list(dict.fromkeys([*flagged, *rank_hits(hits, cap)]))[:cap]
        twin = state.get("twin_stats")
        ctx.log(
            f"gathered {len(found)} evidence items ({len(flagged)} flagged by the fetch stage) "
            f"and {twin.n_programs if twin else 0} precedent programs"
        )
        return {"scratch": {ctx.node_id: {"evidence_ids": found}}}

    async def run_extract(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        if fixture_run(state):
            return await _fixture_extract(state, ctx, lane)
        provided = [
            i
            for i in _scratch(state, gather).get("evidence_ids", [])
            if i not in excluded_ids(state)
        ]
        if not provided:
            ctx.log("nothing gathered to extract from", "warn")
            return {"scratch": {ctx.node_id: dump_drafts([], {}, evidence_ids=[], chain=[])}}
        candidates = provided

        async def build(scale: float) -> tuple[str, list[str]]:
            evidence, shown = await digest(ctx, candidates, budget=int(DIGEST_CHARS * scale))
            user = (
                f"{describe_program(state)}\n\nAt most {4 + ctx.effort.n_queries} claims.\n\n"
                f"Evidence:\n{evidence}"
            )
            if extra := instructions(ctx):
                user += f"\n\n{extra}"
            return user, shown

        schema = EfficacyDraft if lane == "efficacy" else SafetyDraft
        drafted, _, provided = await ask_fitted(
            ctx,
            f"{extract}.extract",
            system_prompt(f"{lane}_extract"),
            build,
            schema,
            OUT_TOKENS["extract"],
        )
        drafts = (drafted.claims if drafted else [])[: 4 + ctx.effort.n_queries]
        claims, quotes = to_claims(drafts, extract)
        chain: list[dict] = []
        if isinstance(drafted, EfficacyDraft) and drafted.chain:
            by_index = [
                claim_id(extract, " ".join(d.text.split())) if d.text.strip() else None
                for d in drafts
            ]
            chain = [link.model_dump(mode="json") for link in chain_from_draft(drafted, by_index)]
        ctx.log(f"drafted {len(claims)} {lane} claims from {len(provided)} evidence items")
        return {
            "scratch": {
                ctx.node_id: dump_drafts(claims, quotes, evidence_ids=provided, chain=chain)
            }
        }

    async def run_gate(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        mine = _scratch(state, extract)
        if fixture_run(state):
            return await _fixture_gate(state, ctx, lane, mine)
        claims, quotes = load_drafts(mine)
        valid = set(mine.get("evidence_ids", [])) & usable_evidence(state)
        gated = await gate(ctx, claims, quotes, valid)
        for c in gated.values():
            if c.status != "accepted":
                ctx.log(f"{c.status}: {c.text[:90]} ({c.rejection_reason})")
        ctx.log("gate: " + tally(gated))
        delta: dict[str, Any] = {"claims": gated}
        if lane == "efficacy":
            chain = [TranslationLink.model_validate(c) for c in mine.get("chain", [])]
            settled = settle_chain(chain, gated)
            delta["translation_chain"] = settled
            if settled:
                ctx.log(
                    "translation chain: "
                    + ", ".join(f"{link.step} {link.status}" for link in settled)
                )
        return delta

    async def run_score(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        if fixture_run(state):
            return await _fixture_score(state, ctx, lane)
        conf = _ledger_conf()
        # only this lane's claims: the other lane and the cases may not have finished yet
        own = [
            c.id
            for c in state.get("claims", {}).values()
            if c.produced_by == extract and c.status != "rejected"
        ]
        twins = state.get("twin_stats")
        valid = usable_evidence(state)
        program, entities = state["program"], state.get("entities")
        if lane == "efficacy":
            facts = _scratch(state, "fetch_opentargets")
            regulatory = _scratch(state, "fetch_regulatory")
            adjustments, result = score_efficacy(
                EfficacyInputs(
                    genetic_score=facts.get("genetic_association"),
                    somatic_score=facts.get("somatic_mutation"),
                    cancer=any(
                        "cancer" in a for a in (entities.therapeutic_areas if entities else [])
                    ),
                    association_score=facts.get("association_score"),
                    association_evidence_ids=[
                        i for i in facts.get("association_evidence_ids", []) if i in valid
                    ],
                    chain=list(state.get("translation_chain") or []),
                    claim_ids=own,
                    twins=twins,
                    same_target_approved=regulatory.get("same_target_approved", []),
                ),
                conf,
                ctx.node_id,
            )
        else:
            facts = _scratch(state, "fetch_safety")
            keep = lambda ids: [i for i in ids if i in valid]  # noqa: E731
            adjustments, result = score_safety(
                SafetyInputs(
                    liabilities=facts.get("liabilities", []),
                    liability_evidence_ids=keep(facts.get("liability_evidence_ids", [])),
                    same_target_approved=facts.get("same_target_approved", []),
                    labels_checked={
                        d: keep(ids) for d, ids in facts.get("labels", {}).items() if keep(ids)
                    },
                    boxed_warnings={
                        d: keep(ids)
                        for d, ids in facts.get("boxed_warning_evidence_ids", {}).items()
                        if keep(ids)
                    },
                    faers={d: keep(ids) for d, ids in facts.get("faers", {}).items() if keep(ids)},
                    claim_ids=own,
                    twins=twins,
                    fetched="liabilities" in facts,
                    modality=program.modality or infer_modality(program.mechanism),
                    drug_modalities=facts.get("drug_modalities", {}),
                ),
                conf,
                ctx.node_id,
            )
        for a in adjustments:
            ctx.log(f"{a.cause}: {a.factor} x{a.risk_ratio.base:g} ({a.basis})")
        ctx.log(result.headline)
        return {
            "risk_adjustments": {f"{a.cause}:{slug(a.factor)}": a for a in adjustments},
            "assessments": {lane: result},
        }

    return {gather: run_gather, extract: run_extract, gate_id: run_gate, score: run_score}


async def _fixture_gather(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    lane = ctx.node_id.split("_", 1)[0]
    query = f"{lane} of {state['program'].mechanism} in {state['program'].indication}"
    found = await ctx.retriever.retrieve(query, [], None, ctx.effort.retrieval_k)
    twin = state.get("twin_stats")
    await nap(ctx.node_id)
    ctx.log(
        f"gathered {len(found)} evidence items and {twin.n_programs if twin else 0} twin programs"
    )
    return {"scratch": {ctx.node_id: {"evidence_ids": [e.id for e in found]}}}


async def _fixture_extract(state: GraphState, ctx: NodeContext, lane: str) -> dict[str, Any]:
    await touch_llm(ctx, f"{ctx.node_id}.extract")
    await nap(ctx.node_id)
    fixture = fixture_report()
    drafts = [c for c in fixture.claims.values() if c.produced_by == ctx.node_id]
    out: dict[str, Any] = {"claims": [c.model_dump(mode="json") for c in drafts]}
    if lane == "efficacy":
        out["chain"] = [link.model_dump(mode="json") for link in fixture.translation_chain]
    ctx.log(f"drafted {len(drafts)} claims (FIXTURE)")
    return {"scratch": {ctx.node_id: out}}


async def _fixture_gate(
    state: GraphState, ctx: NodeContext, lane: str, mine: dict
) -> dict[str, Any]:
    gated = gate_claims(
        (Claim.model_validate(c) for c in mine.get("claims", [])), usable_evidence(state)
    )
    await nap(ctx.node_id)
    ctx.log("gate: " + tally(gated))
    delta: dict[str, Any] = {"claims": gated}
    if lane == "efficacy":
        usable = {i for i, c in gated.items() if c.status != "rejected"}
        delta["translation_chain"] = [
            link.model_copy(
                update={
                    "claim_ids": [c for c in link.claim_ids if c in usable],
                    "status": "missing"
                    if link.claim_ids and not any(c in usable for c in link.claim_ids)
                    else link.status,
                }
            )
            for link in fixture_report().translation_chain
        ]
    return delta


async def _fixture_score(state: GraphState, ctx: NodeContext, lane: str) -> dict[str, Any]:
    fixture = fixture_report()
    usable = {i for i, c in state.get("claims", {}).items() if c.status != "rejected"}
    valid = usable_evidence(state)
    assert fixture.ledger is not None
    adjustments: dict[str, RiskAdjustment] = {}
    for step in fixture.ledger.steps:
        if step.cause not in _CAUSES[lane]:
            continue
        claims = [c for c in step.claim_ids if c in usable]
        evidence = [e for e in step.evidence_ids if e in valid]
        # an adjustment that had support and has lost all of it (rejected claims, excluded evidence) drops out
        if (step.claim_ids or step.evidence_ids) and not (claims or evidence):
            continue
        adjustments[f"{step.cause}:{slug(step.factor)}"] = RiskAdjustment(
            cause=step.cause,
            factor=step.factor,
            risk_ratio=step.risk_ratio,
            basis=step.basis,
            citation=step.citation,
            inputs={"fixture": 1},
            claim_ids=claims,
            evidence_ids=evidence,
        )
    results = {}
    for found in fixture.assessments:
        if found.cause == lane:
            results[lane] = found.model_copy(
                update={"claim_ids": [c for c in found.claim_ids if c in usable]}
            )
    await nap(ctx.node_id)
    ctx.log(f"{len(adjustments)} risk adjustments (FIXTURE ratios)")
    return {"risk_adjustments": adjustments, "assessments": results}
