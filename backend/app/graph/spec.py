from app.contracts import GraphEdge, GraphSpec, NodeKind
from app.graph.registry import get_registry
from app.graph.topology import EDGES

# placeholder palette; Stage 2F replaces it with the sampled Unobio palette
KIND_COLORS: dict[NodeKind, str] = {
    "data": "#2563eb",
    "processing": "#64748b",
    "knowledge": "#0d9488",
    "quant": "#7c3aed",
    "bull": "#16a34a",
    "bear": "#dc2626",
    "analysis": "#d97706",
    "output": "#0f172a",
}


def build_graph_spec() -> GraphSpec:
    return GraphSpec(
        nodes=[entry.spec for entry in get_registry().values()],
        edges=[GraphEdge(source=s, target=t) for s, t in EDGES],
        kind_colors=KIND_COLORS,
    )
