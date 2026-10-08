from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="fetch_regulatory",
    label="openFDA",
    kind="data",
    phase="fetch",
    description="Fetches labels and approvals for standard of care and competitors.",
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying openFDA (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(ctx, state, "label")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
