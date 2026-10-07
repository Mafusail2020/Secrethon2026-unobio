from typing import Any, Literal

from pydantic import Field, HttpUrl

from app.contracts.common import Contract
from app.contracts.evidence import Evidence, SourceRef
from app.contracts.program import ProgramInput, RunOptions


class CreateRunRequest(Contract):
    program: ProgramInput
    options: RunOptions = Field(default_factory=RunOptions)


class CorrectionRequest(Contract):
    text: str = Field(min_length=1, max_length=2000)
    exclude_evidence_ids: list[str] = Field(default_factory=list)
    add_links: list[HttpUrl] = Field(default_factory=list, max_length=20)
    add_notes: str | None = Field(default=None, max_length=5000)


class EvidenceDetail(Contract):
    evidence: Evidence
    source: SourceRef


class HealthStatus(Contract):
    status: Literal["ok"] = "ok"
    llm_mode: Literal["mock", "live"]
    llm_cache: bool
    has_api_key: bool


class ErrorBody(Contract):
    code: str
    message: str
    details: list[dict[str, Any]] = Field(default_factory=list)


class ErrorResponse(Contract):
    error: ErrorBody
