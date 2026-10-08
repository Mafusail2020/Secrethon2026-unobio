from collections import Counter
from typing import Any

from pydantic import Field

from app.contracts import CaseStance, Claim, NodeSpec
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.graph.topology import STANCES, case_container, case_node
from app.nodes._analysis import (
    DIGEST_CHARS,
    Draft,
    DraftClaims,
    ask,
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
from app.nodes._data import client, entity_ids, force_refresh, register
from app.nodes._fixture import excluded_ids, fixture_report, nap, touch_llm
from app.nodes.base import NodeContext, NodeRun
from app.sources.base import SourceError
from app.sources.europepmc import EuropePMCClient
from app.sources.records import paper_records

_GOAL = {
    "bull": "strongest supported reasons to invest",
    "bear": (
        "strongest supported reasons not to invest, including terminated trials, stop reasons, "
        "safety liabilities and null results"
    ),
}
_STANCE = {"bull": "pro", "bear": "con"}
# what the bear side always looks for, whatever the planner asked
_CONTRADICTIONS = (
    "{subject} terminated futility stopped",
    "{subject} withdrawn discontinued",
    "{subject} safety liability adverse events toxicity",
    "{disease} trial did not meet primary endpoint no significant difference",
    "stopped stop reason max clinical stage {subject}",
    "{disease} approved standard of care",
)
_SUPPORT = (
    "{subject} {disease} efficacy primary endpoint met",
    "{subject} genetic association {disease}",
    "approved max clinical stage {subject}",
)
# one fresh Europe PMC search per side, for what the fetch stage is least likely to have pulled
_FRESH = {
    "bull": '{subject} AND {disease} AND ("met its primary endpoint" OR "significantly improved" '
    'OR "proof of concept" OR "target engagement")',
    "bear": '{subject} AND {disease} AND (futility OR "did not meet" OR "no significant" '
    'OR discontinued OR "failed to" OR withdrawn)',
}


def container_spec(stance: CaseStance) -> NodeSpec:
    return NodeSpec(
        id=case_container(stance),
        label=f"{stance.capitalize()} case",
        kind=stance,
        phase="cases",
        description=f"Finds the {_GOAL[stance]}.",
        reads=["entities", "questions", "evidence_ids", "twin_stats"],
        writes=["claims", "scratch"],
    )


def _specs(stance: CaseStance) -> list[NodeSpec]:
    parent = case_container(stance)
    label = stance.capitalize()
    return [
        NodeSpec(
            id=case_node(stance, "query_planner"),
            label=f"{label} query planner",
            kind="analysis",
            phase="cases",
            description=f"Turns the open questions into {stance}-leaning retrieval queries.",
            reads=["entities", "questions"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=case_node(stance, "retriever"),
            label=f"{label} retriever",
            kind="knowledge",
            phase="cases",
            description=f"Pulls the frozen evidence that matches the {stance} queries.",
            reads=["entities", "evidence_ids", "scratch"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=case_node(stance, "claim_writer"),
            label=f"{label} claim writer",
            kind="analysis",
            phase="cases",
            description=f"Drafts claims for the {_GOAL[stance]}, each citing evidence ids.",
            reads=["entities", "scratch"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=case_node(stance, "claim_gate"),
            label=f"{label} claim gate",
            kind="processing",
            phase="cases",
            description="Rejects or downgrades drafted claims whose evidence ids are not valid.",
            reads=["evidence_ids", "scratch"],
            writes=["claims"],
            parent=parent,
        ),
    ]


SPECS: list[NodeSpec] = [spec for stance in STANCES for spec in _specs(stance)]


class QueryPlan(Draft):
    queries: list[str] = Field(default_factory=list)


def _names(state: GraphState) -> tuple[str, str]:
    """(subject, disease) words for templates: target and drug if known, else the mechanism."""
    program, entities = state["program"], state.get("entities")
    disease = entities.disease.label if entities else program.indication
    parts = [entities.target.label if entities and entities.target else None]
    parts.append(entities.drug.label if entities and entities.drug else program.drug_name)
    subject = " ".join(p for p in parts if p) or program.mechanism
    return subject, disease


def template_queries(stance: CaseStance, state: GraphState) -> list[str]:
    subject, disease = _names(state)
    templates = _CONTRADICTIONS if stance == "bear" else _SUPPORT
    return [t.format(subject=subject, disease=disease) for t in templates]


def merge_queries(planned: list[str], templates: list[str], n: int) -> list[str]:
    cleaned = [" ".join(q.split()) for q in planned]
    return list(dict.fromkeys(q for q in [*cleaned[:n], *templates] if q))


def rank_hits(hits: list[list[str]], cap: int) -> list[str]:
    """Items several queries found first, then in the order they were found."""
    counts = Counter(i for found in hits for i in found)
    order = list(dict.fromkeys(i for found in hits for i in found))
    return sorted(order, key=lambda i: (-counts[i], order.index(i)))[:cap]


def _fresh_query(stance: CaseStance, state: GraphState) -> str | None:
    program, entities = state["program"], state.get("entities")
    names = [entities.target.label if entities and entities.target else None]
    names.append(entities.drug.label if entities and entities.drug else program.drug_name)
    names = [n for n in names if n]
    if not names:
        return None
    subject = "(" + " OR ".join(f'"{n}"' for n in dict.fromkeys(names)) + ")"
    disease = f'"{entities.disease.label if entities else program.indication}"'
    return _FRESH[stance].format(subject=subject, disease=disease)


async def _fresh_evidence(stance: CaseStance, state: GraphState, ctx: NodeContext) -> list[str]:
    epmc = client(ctx, "europepmc", EuropePMCClient)
    query = _fresh_query(stance, state)
    if epmc is None or query is None:
        return []
    try:
        papers = await epmc.search(
            query, page_size=max(3, ctx.effort.retrieval_k // 2), force_refresh=force_refresh(state)
        )
    except SourceError as exc:
        ctx.log(f"fresh literature search failed: {exc}", "warn")
        return []
    ids = entity_ids(state.get("entities"))
    records = [r for r in (paper_records(p, ids) for p in papers) if r is not None]
    await register(ctx, state, records)
    excluded = excluded_ids(state)
    found = [e.id for _, items in records for e in items if e.id not in excluded]
    ctx.log(f"fresh Europe PMC search: {len(papers)} papers")
    return found


def _twin_context(state: GraphState) -> str:
    twin = state.get("twin_stats")
    if twin is None:
        return ""
    stopped = [t for t in twin.twins if t.status == "stopped"]
    lines = [
        f"Precedent programs ({twin.match_level}, {twin.n_programs} comparable): prior probability "
        f"of approval {twin.prior_pos.base:.0%} ({twin.prior_pos.low:.0%}-{twin.prior_pos.high:.0%})."
    ]
    lines += [
        f"- {t.drug} in {t.disease}: {t.max_stage}, stopped ({t.stop_reason or 'reason unknown'})"
        for t in stopped[:6]
    ]
    return "Context only, not citable (cite the evidence items instead):\n" + "\n".join(lines)


def make_nodes(stance: CaseStance) -> dict[str, NodeRun]:
    """Run functions for one stance. Same implementation, compiled once per stance."""
    planner, retrieve, writer, gate_id = (
        case_node(stance, step)
        for step in ("query_planner", "retriever", "claim_writer", "claim_gate")
    )

    async def query_planner(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        if fixture_run(state):
            return await _fixture_planner(state, ctx)
        n = ctx.effort.n_queries
        questions = "\n".join(f"- [{q.section}] {q.question}" for q in state.get("questions", []))
        user = (
            f"{describe_program(state)}\n\nSide: {stance} — find the {_GOAL[stance]}.\n"
            f"Planned diligence questions:\n{questions or '(none)'}\n\nWrite up to {n} queries."
        )
        if extra := instructions(ctx):
            user += f"\n\n{extra}"
        plan = await ask(
            ctx, f"{planner}.plan", system_prompt("query_planner"), user, QueryPlan, max_tokens=600
        )
        queries = merge_queries(plan.queries if plan else [], template_queries(stance, state), n)
        ctx.log(f"planned {len(queries)} {stance} queries")
        for q in queries:
            ctx.progress(f"query: {q}")
        return {"scratch": {ctx.node_id: {"queries": queries}}}

    async def retriever(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        if fixture_run(state):
            return await _fixture_retriever(state, ctx)
        queries = state.get("scratch", {}).get(planner, {}).get("queries", [])
        ids = entity_ids(state.get("entities"))
        k = ctx.effort.retrieval_k
        hits = [[e.id for e in await ctx.retriever.retrieve(q, ids, stance, k)] for q in queries]
        fresh = await _fresh_evidence(stance, state, ctx)
        found = rank_hits([*hits, fresh], max(12, 3 * k))
        ctx.log(
            f"retrieved {len(found)} evidence items for {len(queries)} queries"
            + (f" ({len(fresh)} from a fresh search)" if fresh else "")
        )
        return {"scratch": {ctx.node_id: {"evidence_ids": found}}}

    async def claim_writer(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        if fixture_run(state):
            return await _fixture_writer(state, ctx)
        provided = state.get("scratch", {}).get(retrieve, {}).get("evidence_ids", [])
        provided = [i for i in provided if i not in excluded_ids(state)]
        if not provided:
            ctx.log("no evidence to write from", "warn")
            return {"scratch": {ctx.node_id: dump_drafts([], {}, evidence_ids=[])}}
        limit = 3 + ctx.effort.n_queries
        questions = "\n".join(f"- [{q.section}] {q.question}" for q in state.get("questions", []))
        candidates = provided

        async def build(scale: float) -> tuple[str, list[str]]:
            evidence, shown = await digest(ctx, candidates, budget=int(DIGEST_CHARS * scale))
            user = (
                f"{describe_program(state)}\n\nSide: {stance}. Write at most {limit} claims "
                f"giving the {_GOAL[stance]}.\nUse the section ids of the questions they "
                f"answer:\n{questions}\n\n{_twin_context(state)}\n\nEvidence:\n{evidence}"
            )
            if extra := instructions(ctx):
                user += f"\n\n{extra}"
            return user, shown

        drafted, _, provided = await ask_fitted(
            ctx, f"{writer}.draft", system_prompt("claim_writer"), build, DraftClaims, 2500
        )
        claims, quotes = to_claims(
            (drafted.claims if drafted else [])[:limit], writer, _STANCE[stance]
        )
        ctx.log(f"drafted {len(claims)} {stance} claims from {len(provided)} evidence items")
        return {"scratch": {ctx.node_id: dump_drafts(claims, quotes, evidence_ids=provided)}}

    async def claim_gate(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        mine = state.get("scratch", {}).get(writer, {})
        if fixture_run(state):
            return await _fixture_gate(state, ctx, mine)
        claims, quotes = load_drafts(mine)
        valid = set(mine.get("evidence_ids", [])) & usable_evidence(state)
        gated = await gate(ctx, claims, quotes, valid)
        for c in gated.values():
            if c.status != "accepted":
                ctx.log(f"{c.status}: {c.text[:90]} ({c.rejection_reason})")
        ctx.log("gate: " + tally(gated))
        return {"claims": gated}

    return {planner: query_planner, retrieve: retriever, writer: claim_writer, gate_id: claim_gate}


async def _fixture_planner(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    stance = ctx.node_id.split("_", 1)[0]
    lead = "evidence supporting" if stance == "bull" else "evidence against, failures of"
    questions = [q.question.removeprefix("FIXTURE: ") for q in state.get("questions", [])]
    queries = [f"{lead} {q}" for q in questions][: ctx.effort.n_queries]
    await touch_llm(ctx, f"{ctx.node_id}.plan")
    await nap(ctx.node_id)
    ctx.log(f"planned {len(queries)} {stance} queries")
    return {"scratch": {ctx.node_id: {"queries": queries}}}


async def _fixture_retriever(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    stance: CaseStance = ctx.node_id.split("_", 1)[0]  # type: ignore[assignment]
    queries = (
        state.get("scratch", {}).get(case_node(stance, "query_planner"), {}).get("queries", [])
    )
    found: dict[str, None] = {}
    for query in queries:
        for item in await ctx.retriever.retrieve(query, [], stance, ctx.effort.retrieval_k):
            found.setdefault(item.id)
    await nap(ctx.node_id)
    ctx.log(f"retrieved {len(found)} evidence items for {len(queries)} queries")
    return {"scratch": {ctx.node_id: {"evidence_ids": list(found)}}}


async def _fixture_writer(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    await touch_llm(ctx, f"{ctx.node_id}.draft")
    await nap(ctx.node_id)
    drafts = [c for c in fixture_report().claims.values() if c.produced_by == ctx.node_id]
    ctx.log(f"drafted {len(drafts)} claims (FIXTURE)")
    return {"scratch": {ctx.node_id: {"claims": [c.model_dump(mode="json") for c in drafts]}}}


async def _fixture_gate(state: GraphState, ctx: NodeContext, mine: dict) -> dict[str, Any]:
    raw = mine.get("claims", [])
    gated = gate_claims((Claim.model_validate(c) for c in raw), usable_evidence(state))
    await nap(ctx.node_id)
    ctx.log("gate: " + tally(gated))
    return {"claims": gated}
