from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import fixture_report, nap
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="twin_stats",
    label="Twin stats",
    kind="quant",
    description="Finds historical programs like this one and derives stage reached, stop reasons and a prior success range.",
    reads=["program", "entities"],
    writes=["twin_stats", "source_ids", "evidence_ids"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    ctx.log("looking up historical programs (FIXTURE: no real Open Targets data)")
    await nap(ctx.node_id)
    report = fixture_report()
    twin = report.twin_stats
    assert twin is not None
    cited = {i for t in twin.twins for i in t.source_ids}
    await ctx.register_sources([s for i, s in report.sources.items() if i in cited])
    ctx.log(f"{twin.n_programs} twin programs, prior PoS base {twin.prior_pos.base:.2f}")
    return {"twin_stats": twin}
