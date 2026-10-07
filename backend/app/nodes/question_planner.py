from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="question_planner",
    label="Question planner",
    kind="analysis",
    description="Decides which diligence questions matter for this specific program.",
    reads=["program", "entities"],
    writes=["questions"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
