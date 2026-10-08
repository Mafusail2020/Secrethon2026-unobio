"""The efficacy and safety lanes. Stub bodies: real ones keep these specs and state keys.

Each lane is gather (code) -> extract (one model call) -> gate (code) -> score (formulas):
the model only reads and writes claims; every number comes from a function.
"""

from collections import Counter
from typing import Any

from app.contracts import AssessedCause, Claim, NodeSpec, RiskAdjustment
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.graph.topology import LANES, lane_container, lane_node
from app.nodes._fixture import excluded_ids, fixture_report, nap, slug, touch_llm
from app.nodes.base import NodeContext, NodeRun

_GOAL: dict[str, str] = {
    "efficacy": "whether the drug does what it is meant to do in people",
    "safety": "whether people will tolerate the drug",
}
# the failure causes each lane speaks to (pk_exposure rides with efficacy: it is the exposure link)
_CAUSES: dict[str, tuple[str, ...]] = {
    "efficacy": ("efficacy", "pk_exposure"),
    "safety": ("safety",),
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


def make_nodes(lane: AssessedCause) -> dict[str, NodeRun]:
    gather, extract, gate, score = (
        lane_node(lane, s) for s in ("gather", "extract", "gate", "score")
    )

    async def run_gather(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        query = f"{lane} of {state['program'].mechanism} in {state['program'].indication}"
        found = await ctx.retriever.retrieve(query, [], None, ctx.effort.retrieval_k)
        twin = state.get("twin_stats")
        await nap(ctx.node_id)
        ctx.log(
            f"gathered {len(found)} evidence items and {twin.n_programs if twin else 0} twin programs"
        )
        return {"scratch": {ctx.node_id: {"evidence_ids": [e.id for e in found]}}}

    async def run_extract(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        await touch_llm(ctx, f"{extract}.extract")
        await nap(ctx.node_id)
        fixture = fixture_report()
        drafts = [c for c in fixture.claims.values() if c.produced_by == extract]
        out: dict[str, Any] = {"claims": [c.model_dump(mode="json") for c in drafts]}
        if lane == "efficacy":
            out["chain"] = [link.model_dump(mode="json") for link in fixture.translation_chain]
        ctx.log(f"drafted {len(drafts)} claims (FIXTURE)")
        return {"scratch": {ctx.node_id: out}}

    async def run_gate(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        mine = state.get("scratch", {}).get(extract, {})
        valid = set(state.get("evidence_ids", [])) - excluded_ids(state)
        gated = gate_claims((Claim.model_validate(c) for c in mine.get("claims", [])), valid)
        counts = Counter(c.status for c in gated.values())
        await nap(ctx.node_id)
        ctx.log("gate: " + ", ".join(f"{n} {status}" for status, n in sorted(counts.items())))
        delta: dict[str, Any] = {"claims": gated}
        if lane == "efficacy":
            usable = {i for i, c in gated.items() if c.status != "rejected"}
            chain = fixture_report().translation_chain
            delta["translation_chain"] = [
                link.model_copy(
                    update={
                        "claim_ids": [c for c in link.claim_ids if c in usable],
                        "status": "missing"
                        if link.claim_ids and not any(c in usable for c in link.claim_ids)
                        else link.status,
                    }
                )
                for link in chain
            ]
        return delta

    async def run_score(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        fixture = fixture_report()
        usable = {i for i, c in state.get("claims", {}).items() if c.status != "rejected"}
        valid = set(state.get("evidence_ids", [])) - excluded_ids(state)
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
            adjustment = RiskAdjustment(
                cause=step.cause,
                factor=step.factor,
                risk_ratio=step.risk_ratio,
                basis=step.basis,
                citation=step.citation,
                inputs={"fixture": 1},
                claim_ids=claims,
                evidence_ids=evidence,
            )
            adjustments[f"{step.cause}:{slug(step.factor)}"] = adjustment
        results = {}
        for found in fixture.assessments:
            if found.cause == lane:
                results[lane] = found.model_copy(
                    update={"claim_ids": [c for c in found.claim_ids if c in usable]}
                )
        await nap(ctx.node_id)
        ctx.log(f"{len(adjustments)} risk adjustments (FIXTURE ratios)")
        return {"risk_adjustments": adjustments, "assessments": results}

    return {gather: run_gather, extract: run_extract, gate: run_gate, score: run_score}
