from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import nap
from app.nodes.base import NodeContext
from app.store import KGEdge

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
    evidence = await ctx.store.evidence.get_many_evidence(state.get("evidence_ids", []))
    ctx.log(f"indexing {len(evidence)} evidence items")
    await nap(ctx.node_id)
    await ctx.store.vectors.add(evidence)
    entities = state["entities"]
    nodes = [e for e in (entities.disease, entities.target, entities.drug) if e]
    await ctx.store.kg.add_nodes(nodes)
    edges = [
        KGEdge(source=n.id, target=ev.source_id, relation="mentioned_in", evidence_id=ev.id)
        for n in nodes
        for ev in evidence
    ]
    await ctx.store.kg.add_edges(edges)
    ctx.log(f"added {len(nodes)} entities and {len(edges)} graph edges")
    return {"scratch": {ctx.node_id: {"indexed": len(evidence), "kg_edges": len(edges)}}}
