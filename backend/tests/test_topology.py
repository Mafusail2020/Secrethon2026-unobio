import inspect
from typing import get_args

from app.contracts import NodeKind
from app.graph.registry import get_registry
from app.graph.spec import KIND_COLORS, build_graph_spec
from app.graph.state import INITIAL_KEYS, STATE_KEYS
from app.graph.topology import CONTAINERS, EDGES, ENTRY, EXIT, TOP_LEVEL, runnable_ids


def _reach(start: str, edges: list[tuple[str, str]]) -> set[str]:
    seen, stack = set(), [start]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(t for s, t in edges if s == node)
    return seen


def test_registry_covers_every_node_once():
    registry = get_registry()
    expected = {n for n in TOP_LEVEL} | {i for inner in CONTAINERS.values() for i in inner}
    assert set(registry) == expected
    assert len(registry) == 25
    for node_id, entry in registry.items():
        assert entry.spec.id == node_id


def test_runnable_nodes_have_async_run_and_containers_do_not():
    registry = get_registry()
    for node_id in runnable_ids():
        run = registry[node_id].run
        assert run is not None and inspect.iscoroutinefunction(run), node_id
    for container in CONTAINERS:
        assert registry[container].run is None


def test_edges_only_touch_runnable_nodes():
    runnable = set(runnable_ids())
    for source, target in EDGES:
        assert source in runnable and target in runnable, (source, target)


def test_no_orphans_and_acyclic():
    edges = list(EDGES)
    runnable = set(runnable_ids())
    assert _reach(ENTRY, edges) == runnable
    reverse = [(t, s) for s, t in edges]
    assert _reach(EXIT, reverse) == runnable

    indegree = {n: 0 for n in runnable}
    for _, target in edges:
        indegree[target] += 1
    queue = [n for n, d in indegree.items() if d == 0]
    visited = 0
    while queue:
        node = queue.pop()
        visited += 1
        for s, t in edges:
            if s == node:
                indegree[t] -= 1
                if indegree[t] == 0:
                    queue.append(t)
    assert visited == len(runnable), "graph has a cycle"


def test_subgraph_parents_are_valid():
    registry = get_registry()
    for node_id, entry in registry.items():
        parent = entry.spec.parent
        if parent is None:
            continue
        assert parent in CONTAINERS, node_id
        assert node_id in CONTAINERS[parent]
        assert registry[parent].spec.kind in ("bull", "bear")
    for container, inner in CONTAINERS.items():
        for node_id in inner:
            assert registry[node_id].spec.parent == container


def test_reads_and_writes_use_known_state_keys():
    registry = get_registry()
    written = set(INITIAL_KEYS)
    for entry in registry.values():
        assert set(entry.spec.reads) <= set(STATE_KEYS), entry.spec.id
        assert set(entry.spec.writes) <= set(STATE_KEYS), entry.spec.id
        written |= set(entry.spec.writes)
    for entry in registry.values():
        assert set(entry.spec.reads) <= written, entry.spec.id


def test_critical_and_correctable_flags():
    registry = get_registry()
    critical = {n for n, e in registry.items() if e.spec.critical}
    assert critical == {"input_resolver", "report_assembler", "verdict"}
    not_correctable = {n for n, e in registry.items() if not e.spec.correctable}
    assert not_correctable == {"evidence_normalizer", "knowledge_indexer", "report_assembler"}


def test_graph_spec_has_colors_for_every_kind():
    spec = build_graph_spec()
    assert set(KIND_COLORS) == set(get_args(NodeKind))
    assert set(spec.kind_colors) == set(get_args(NodeKind))
    assert all(n.description for n in spec.nodes)


def test_every_node_declares_a_phase_and_inner_nodes_share_their_container_phase():
    registry = get_registry()
    assert all(e.spec.phase for e in registry.values())
    for node_id, entry in registry.items():
        if entry.spec.parent:
            assert entry.spec.phase == registry[entry.spec.parent].spec.phase, node_id
