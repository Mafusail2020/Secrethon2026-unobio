from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.contracts import (
    Correction,
    Evidence,
    LLMCallRecord,
    LogLevel,
    LogLine,
    NodeSpec,
    RunSummary,
    SourceRef,
    utcnow,
)
from app.graph.registry import get_registry
from app.llm.node_llm import NodeLLM, RunLLM
from app.llm.types import EffortKnobs
from app.store.fakes import RunRetriever

if TYPE_CHECKING:
    from app.core.services import Services


@dataclass
class RunContext:
    """Per-run state shared by all node executions. Passed to LangGraph via config."""

    run_id: str
    services: "Services"
    summary: RunSummary
    llm: RunLLM
    knobs: EffortKnobs
    corrections: list[Correction]  # whole lineage, oldest first
    parent_run_id: str | None = None
    reuse: dict[str, dict[str, Any]] = field(default_factory=dict)  # node id -> parent delta
    parent_outputs: dict[str, Any] = field(default_factory=dict)  # node id -> parent NodeExecution
    calls: list[LLMCallRecord] = field(default_factory=list)
    failed_nodes: list[str] = field(default_factory=list)

    def corrections_for(self, node_id: str) -> list[Correction]:
        ids = {node_id}
        entry = get_registry().get(node_id)
        if entry and entry.spec.parent:
            ids.add(entry.spec.parent)
        return [c for c in self.corrections if c.node_id in ids]

    @property
    def excluded_evidence_ids(self) -> set[str]:
        return {i for c in self.corrections for i in c.exclude_evidence_ids}


class NodeCtx:
    """What a node sees as `ctx`. Implements nodes.base.NodeContext."""

    def __init__(self, rc: RunContext, spec: NodeSpec, evidence_ids: Sequence[str]) -> None:
        self._rc = rc
        self._bus = rc.services.bus
        self.run_id = rc.run_id
        self.node_id = spec.id
        self.effort = rc.knobs
        self.sources = rc.services.sources
        self.store = rc.services.store
        self.retriever = RunRetriever(
            rc.services.store, [i for i in evidence_ids if i not in rc.excluded_evidence_ids]
        )
        self.llm = NodeLLM(rc.llm, spec.kind, self._on_call, self._on_llm_log)
        self.log_lines: list[LogLine] = []
        self.calls: list[LLMCallRecord] = []
        self.source_ids: list[str] = []
        self.evidence_ids: list[str] = []

    def log(self, message: str, level: LogLevel = "info") -> None:
        self.log_lines.append(LogLine(ts=utcnow(), level=level, message=message))
        self._bus.emit(self.run_id, "node.log", self.node_id, level=level, message=message)

    def progress(self, message: str) -> None:
        self.log_lines.append(LogLine(ts=utcnow(), level="info", message=message))
        self._bus.emit(
            self.run_id, "node.log", self.node_id, level="info", message=message, progress=True
        )

    def corrections_for(self, node_id: str | None = None) -> list[Correction]:
        return self._rc.corrections_for(node_id or self.node_id)

    async def register_sources(self, sources: Sequence[SourceRef]) -> list[str]:
        await self.store.evidence.put_sources(sources)
        ids = [s.id for s in sources]
        self.source_ids.extend(i for i in ids if i not in self.source_ids)
        return ids

    async def register_evidence(self, evidence: Sequence[Evidence]) -> list[str]:
        await self.store.evidence.put_evidence(evidence)
        ids = [e.id for e in evidence]
        self.evidence_ids.extend(i for i in ids if i not in self.evidence_ids)
        return ids

    def _on_llm_log(self, level: str, message: str) -> None:
        self.log(message, level)  # type: ignore[arg-type]

    async def _on_call(self, record: LLMCallRecord) -> None:
        self.calls.append(record)
        self._rc.calls.append(record)
        self._bus.emit(self.run_id, "llm.call", self.node_id, **record.model_dump(mode="json"))
        await self._rc.services.llm_repo.add_call(self.run_id, self.node_id, record)
