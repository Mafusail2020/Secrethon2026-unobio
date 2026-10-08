from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="fetch_safety",
    label="Safety data",
    kind="data",
    phase="fetch",
    description=(
        "Fetches target safety liabilities, tissue expression, label warnings and adverse-event "
        "counts for the target and its drug class."
    ),
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("querying safety sources (FIXTURE: no network call)")
    await nap(ctx.node_id)
    sources, evidence = await register_fixture_sources(ctx, state, "db_record", title_has="safety")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
