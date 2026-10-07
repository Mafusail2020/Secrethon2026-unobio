from typing import Any

from app.contracts import CaseStance, NodeSpec
from app.graph.state import GraphState
from app.graph.topology import STANCES, case_container, case_node
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

    async def query_planner(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        return {}

    async def retriever(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        return {}

    async def claim_writer(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        return {}

    async def claim_gate(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
        return {}

    return {
        case_node(stance, "query_planner"): query_planner,
        case_node(stance, "retriever"): retriever,
        case_node(stance, "claim_writer"): claim_writer,
        case_node(stance, "claim_gate"): claim_gate,
    }
