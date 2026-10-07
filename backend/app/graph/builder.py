from collections import defaultdict
from functools import cache

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.graph.executor import execute_node
from app.graph.registry import NodeEntry, get_registry
from app.graph.state import GraphState
from app.graph.topology import EDGES, ENTRY, EXIT, runnable_ids


def _wrap(entry: NodeEntry):
    async def node(state: GraphState, config: RunnableConfig) -> dict:
        return await execute_node(config["configurable"]["run_ctx"], entry, state)

    node.__name__ = entry.spec.id
    return node


@cache
def get_graph():
    """Compiled once; per-run data travels in config['configurable']['run_ctx']."""
    registry = get_registry()
    graph = StateGraph(GraphState)
    for node_id in runnable_ids():
        graph.add_node(node_id, _wrap(registry[node_id]))
    graph.add_edge(START, ENTRY)
    incoming: dict[str, list[str]] = defaultdict(list)
    for source, target in EDGES:
        incoming[target].append(source)
    for target, sources in incoming.items():
        # a list means "wait for all"; a single source is a plain edge or a fan-out
        graph.add_edge(sources if len(sources) > 1 else sources[0], target)
    graph.add_edge(EXIT, END)
    return graph.compile()
