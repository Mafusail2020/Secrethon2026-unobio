from collections import Counter
from typing import Any

from app.contracts import CaseStance, Claim, NodeSpec
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.graph.topology import STANCES, case_container, case_node
from app.nodes._fixture import excluded_ids, fixture_report, nap, touch_llm
from app.nodes.base import NodeContext, NodeRun

_GOAL = {
    "bull": "strongest supported reasons to invest",
    "bear": (
        "strongest supported reasons not to invest, including terminated trials, stop reasons, "
        "safety liabilities and null results"
    ),
}


def container_spec(stance: CaseStance) -> NodeSpec:
    return NodeSpec(
        id=case_container(stance),
        label=f"{stance.capitalize()} case",
        kind=stance,
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
            description=f"Turns the open questions into {stance}-leaning retrieval queries.",
            reads=["entities", "questions"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=case_node(stance, "retriever"),
            label=f"{label} retriever",
            kind="knowledge",
            description=f"Pulls the frozen evidence that matches the {stance} queries.",
            reads=["entities", "evidence_ids", "scratch"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=case_node(stance, "claim_writer"),
            label=f"{label} claim writer",
            kind="analysis",
            description=f"Drafts claims for the {_GOAL[stance]}, each citing evidence ids.",
            reads=["entities", "scratch"],
            writes=["scratch"],
            parent=parent,
        ),
        NodeSpec(
            id=case_node(stance, "claim_gate"),
            label=f"{label} claim gate",
            kind="processing",
            description="Rejects or downgrades drafted claims whose evidence ids are not valid.",
            reads=["evidence_ids", "scratch"],
            writes=["claims"],
            parent=parent,
        ),
    ]


SPECS: list[NodeSpec] = [spec for stance in STANCES for spec in _specs(stance)]


def make_nodes(stance: CaseStance) -> dict[str, NodeRun]:
    """Run functions for one stance. Same implementation, compiled once per stance."""
    planner, retrieve, writer, gate = (
        case_node(stance, step)
        for step in ("query_planner", "retriever", "claim_writer", "claim_gate")
    )

    async def query_planner(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        lead = "evidence supporting" if stance == "bull" else "evidence against, failures of"
        questions = [q.question.removeprefix("FIXTURE: ") for q in state.get("questions", [])]
        queries = [f"{lead} {q}" for q in questions][: ctx.effort.n_queries]
        await touch_llm(ctx, f"{planner}.plan")
        await nap(ctx.node_id)
        ctx.log(f"planned {len(queries)} {stance} queries")
        return {"scratch": {ctx.node_id: {"queries": queries}}}

    async def retriever(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        queries = state.get("scratch", {}).get(planner, {}).get("queries", [])
        found: dict[str, None] = {}
        for query in queries:
            for item in await ctx.retriever.retrieve(query, [], stance, ctx.effort.retrieval_k):
                found.setdefault(item.id)
        await nap(ctx.node_id)
        ctx.log(f"retrieved {len(found)} evidence items for {len(queries)} queries")
        return {"scratch": {ctx.node_id: {"evidence_ids": list(found)}}}

    async def claim_writer(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        await touch_llm(ctx, f"{writer}.draft")
        await nap(ctx.node_id)
        drafts = [c for c in fixture_report().claims.values() if c.produced_by == gate]
        ctx.log(f"drafted {len(drafts)} claims (FIXTURE)")
        return {"scratch": {ctx.node_id: {"claims": [c.model_dump(mode="json") for c in drafts]}}}

    async def claim_gate(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        raw = state.get("scratch", {}).get(writer, {}).get("claims", [])
        valid = set(state.get("evidence_ids", [])) - excluded_ids(state)
        gated = gate_claims((Claim.model_validate(c) for c in raw), valid)
        counts = Counter(c.status for c in gated.values())
        await nap(ctx.node_id)
        ctx.log("gate: " + ", ".join(f"{n} {status}" for status, n in sorted(counts.items())))
        return {"claims": gated}

    return {planner: query_planner, retrieve: retriever, writer: claim_writer, gate: claim_gate}
