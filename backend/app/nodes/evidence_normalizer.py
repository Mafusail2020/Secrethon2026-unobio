from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import nap
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="evidence_normalizer",
    label="Evidence normalizer",
    kind="processing",
    description="Dedupes and chunks fetched material into canonical evidence and source records.",
    reads=["source_ids", "evidence_ids", "scratch"],
    writes=["source_ids", "evidence_ids"],
    correctable=False,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    evidence, sources = state.get("evidence_ids", []), state.get("source_ids", [])
    ctx.log(f"normalizing {len(evidence)} evidence items from {len(sources)} sources")
    await nap(ctx.node_id)
    ctx.log("no duplicates found")
    return {}
