from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="evidence_ledger",
    label="Evidence ledger",
    kind="quant",
    description="Combines the twin prior with likelihood ratios from evidence into a posterior range.",
    reads=["twin_stats", "claims", "sections", "evidence_ids"],
    writes=["ledger"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
