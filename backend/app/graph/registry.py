from dataclasses import dataclass
from functools import cache
from types import ModuleType

from app.contracts import NodeSpec
from app.graph.topology import STANCES, TOP_LEVEL, case_container
from app.nodes import (
    bear_case,
    bull_case,
    evidence_ledger,
    evidence_normalizer,
    fetch_literature,
    fetch_opentargets,
    fetch_regulatory,
    fetch_trials,
    ingest_user_input,
    input_resolver,
    knowledge_indexer,
    question_planner,
    report_assembler,
    section_analysts,
    twin_stats,
    valuation,
    verdict,
)
from app.nodes.base import NodeRun
from app.nodes.subgraphs import bull_bear

_MODULES: tuple[ModuleType, ...] = (
    input_resolver,
    question_planner,
    fetch_opentargets,
    fetch_trials,
    fetch_literature,
    fetch_regulatory,
    ingest_user_input,
    twin_stats,
    evidence_normalizer,
    knowledge_indexer,
    bull_case,
    bear_case,
    section_analysts,
    evidence_ledger,
    valuation,
    verdict,
    report_assembler,
)


@dataclass(frozen=True)
class NodeEntry:
    spec: NodeSpec
    run: NodeRun | None  # None for container nodes, which only group inner nodes in the UI


@cache
def get_registry() -> dict[str, NodeEntry]:
    """node id -> entry, in display order (inner nodes follow their container)."""
    top = {m.SPEC.id: NodeEntry(m.SPEC, getattr(m, "run", None)) for m in _MODULES}
    inner_specs = {s.id: s for s in bull_bear.SPECS}
    registry: dict[str, NodeEntry] = {}
    for node_id in TOP_LEVEL:
        registry[node_id] = top[node_id]
        for stance in STANCES:
            if node_id == case_container(stance):
                runs = bull_bear.make_nodes(stance)
                for inner_id, run in runs.items():
                    registry[inner_id] = NodeEntry(inner_specs[inner_id], run)
    return registry
