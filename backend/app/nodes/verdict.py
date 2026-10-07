from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="verdict",
    label="Verdict",
    kind="quant",
    description="Applies thresholds and reason codes to decide invest, conditional or do not invest.",
    reads=["ledger", "valuation", "claims", "key_risks", "twin_stats"],
    writes=["verdict"],
    correctable=True,
    critical=True,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
