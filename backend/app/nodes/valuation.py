from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import fixture_report, nap
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="valuation",
    label="Valuation",
    kind="quant",
    phase="quant",
    description="Estimates capital and time to the next milestone and an rNPV range.",
    reads=["program", "entities", "twin_stats", "ledger", "claims"],
    writes=["valuation"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("estimating capital and time to the next milestone (FIXTURE assumptions)")
    await nap(ctx.node_id)
    valuation = fixture_report().valuation
    assert valuation is not None
    ctx.log(f"next milestone: {valuation.next_milestone}")
    return {"valuation": valuation}
