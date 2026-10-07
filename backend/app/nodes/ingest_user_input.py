from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import nap, register_fixture_sources
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="ingest_user_input",
    label="User input",
    kind="data",
    description="Turns user notes, links and preclinical data into user-provided evidence.",
    reads=["program", "entities"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program = state["program"]
    added = [c for c in ctx.corrections_for() if c.add_notes or c.add_links]
    await nap(ctx.node_id)
    if not (program.notes or program.links or program.preclinical_results or added):
        ctx.log("no user-provided material")
        return {}
    ctx.log("turning user notes, links and results into user-provided evidence")
    sources, evidence = await register_fixture_sources(ctx, state, "user_provided")
    ctx.log(f"registered {sources} source(s) and {evidence} evidence item(s)")
    return {}
