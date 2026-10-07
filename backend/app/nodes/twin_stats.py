from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
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
    return {}
