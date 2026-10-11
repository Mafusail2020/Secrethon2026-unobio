from functools import cache

from app.graph.topology import EDGES, runnable_ids


@cache
def longest_chain() -> int:
    """The steps on the longest path through the pipeline: they cannot overlap in time."""
    after: dict[str, list[str]] = {}
    for source, target in EDGES:
        after.setdefault(source, []).append(target)
    depth: dict[str, int] = {}

    def of(node: str) -> int:
        if node not in depth:
            depth[node] = 1 + max((of(n) for n in after.get(node, ())), default=0)
        return depth[node]

    return max(of(node) for node in runnable_ids())


def hold_per_step(total_seconds: float) -> float:
    """How long each step is kept on screen so a run of fast steps takes about `total_seconds`."""
    return total_seconds / longest_chain() if total_seconds > 0 else 0.0
