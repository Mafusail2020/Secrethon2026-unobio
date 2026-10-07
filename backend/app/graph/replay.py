from app.graph.topology import CONTAINERS, EDGES


def expand(node_id: str) -> set[str]:
    return set(CONTAINERS[node_id]) if node_id in CONTAINERS else {node_id}


def descendants(node_ids: set[str]) -> set[str]:
    found: set[str] = set()
    stack = list(node_ids)
    while stack:
        node = stack.pop()
        for source, target in EDGES:
            if source == node and target not in found:
                found.add(target)
                stack.append(target)
    return found


def affected_set(corrected_node_id: str) -> set[str]:
    """Nodes that must recompute: the corrected node (a container means all its inner nodes)
    plus everything downstream. Every other node replays the parent run's stored delta."""
    base = expand(corrected_node_id)
    return base | descendants(base)
