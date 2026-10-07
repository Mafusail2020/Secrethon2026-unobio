from datetime import datetime
from typing import Any, Literal

from pydantic import Field, HttpUrl

from app.contracts.common import Contract, Decision, LogLevel, Range, SectionId
from app.contracts.program import ProgramInput, RunOptions
from app.contracts.report import UnderwritingReport

RunStatus = Literal["queued", "running", "completed", "failed"]
NodeStatus = Literal["pending", "running", "done", "failed", "skipped", "reused"]
RunEventType = Literal[
    "run.started",
    "node.started",
    "node.log",
    "node.completed",
    "node.failed",
    "node.skipped",
    "node.reused",
    "llm.call",
    "run.completed",
    "run.failed",
]


class LogLine(Contract):
    ts: datetime
    level: LogLevel
    message: str


class LLMCallRecord(Contract):
    model: str
    purpose: str
    tokens_in: int
    tokens_out: int
    cost_usd: float | None = None
    cached: bool = False
    latency_ms: int


class NodeExecution(Contract):
    run_id: str
    node_id: str
    status: NodeStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    input_summary: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    log: list[LogLine] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    llm_calls: list[LLMCallRecord] = Field(default_factory=list)
    cost_usd: float | None = None
    error: str | None = None
    correction_ids: list[str] = Field(default_factory=list)


class RunSummary(Contract):
    id: str
    status: RunStatus
    program: ProgramInput
    options: RunOptions
    created_at: datetime
    parent_run_id: str | None = None
    decision: Decision | None = None
    error: str | None = None


class RunDetail(Contract):
    summary: RunSummary
    nodes: list[NodeExecution] = Field(default_factory=list)
    report: UnderwritingReport | None = None


class Correction(Contract):
    id: str
    run_id: str
    node_id: str
    text: str
    exclude_evidence_ids: list[str] = Field(default_factory=list)
    add_links: list[HttpUrl] = Field(default_factory=list)
    add_notes: str | None = None
    created_at: datetime


class RunEvent(Contract):
    seq: int
    run_id: str
    ts: datetime
    type: RunEventType
    node_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class ReportDiff(Contract):
    from_run: str
    to_run: str
    decision_before: Decision | None = None
    decision_after: Decision | None = None
    pos_before: Range | None = None
    pos_after: Range | None = None
    changed_sections: list[SectionId] = Field(default_factory=list)
    added_claim_ids: list[str] = Field(default_factory=list)
    removed_claim_ids: list[str] = Field(default_factory=list)
    recomputed_nodes: list[str] = Field(default_factory=list)
