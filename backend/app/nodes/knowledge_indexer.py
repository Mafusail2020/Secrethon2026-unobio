from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="knowledge_indexer",
    label="Knowledge indexer",
    kind="knowledge",
    description="Builds the vector index and knowledge-graph edges over the frozen evidence set.",
    reads=["entities", "evidence_ids"],
    writes=["scratch"],
    correctable=False,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
