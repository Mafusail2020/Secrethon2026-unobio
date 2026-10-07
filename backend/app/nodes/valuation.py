from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="valuation",
    label="Valuation",
    kind="quant",
    description="Estimates capital and time to the next milestone and an rNPV range.",
    reads=["program", "entities", "twin_stats", "ledger", "claims"],
    writes=["valuation"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
