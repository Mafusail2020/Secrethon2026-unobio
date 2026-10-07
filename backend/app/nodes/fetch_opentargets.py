from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="fetch_opentargets",
    label="Open Targets",
    kind="data",
    description="Fetches target-disease associations by datatype, known drugs, safety liabilities and tractability.",
    reads=["program", "entities", "questions"],
    writes=["source_ids", "evidence_ids", "scratch"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
