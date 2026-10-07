from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="input_resolver",
    label="Input resolver",
    kind="processing",
    description="Resolves free-text indication, mechanism and drug into disease, target and drug ids plus therapeutic areas.",
    reads=["program"],
    writes=["entities"],
    correctable=True,
    critical=True,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
