from datetime import datetime

from pydantic import Field

from app.contracts.assessment import AssessmentResult
from app.contracts.claims import (
    Claim,
    DiligenceQuestion,
    Risk,
    SectionResult,
    TranslationLink,
)
from app.contracts.common import Contract, Range, SectionId
from app.contracts.evidence import Evidence, ResolvedEntities, SourceRef
from app.contracts.program import Effort, ProgramInput
from app.contracts.quant import EvidenceLedger, TwinStats, Valuation, Verdict


class RunMeta(Contract):
    models_used: list[str] = Field(default_factory=list)
    effort: Effort
    panel_size: int | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float | None = None
    duration_s: float = 0
    cache_hits: int = 0
    created_at: datetime
    parent_run_id: str | None = None
    correction_id: str | None = None
    synthetic: bool = False
    failed_nodes: list[str] = Field(default_factory=list)


class UnderwritingReport(Contract):
    run_id: str
    program: ProgramInput
    entities: ResolvedEntities
    verdict: Verdict
    pos: Range
    sections: dict[SectionId, SectionResult]
    translation_chain: list[TranslationLink] = Field(default_factory=list)
    twin_stats: TwinStats | None = None
    ledger: EvidenceLedger | None = None
    assessments: list[AssessmentResult] = Field(
        default_factory=list, description="The efficacy and safety lanes' results."
    )
    valuation: Valuation | None = None
    key_risks: list[Risk] = Field(default_factory=list)
    critical_unknowns: list[str] = Field(default_factory=list)
    diligence_questions: list[DiligenceQuestion] = Field(default_factory=list, max_length=10)
    claims: dict[str, Claim] = Field(default_factory=dict)
    evidence: dict[str, Evidence] = Field(default_factory=dict)
    sources: dict[str, SourceRef] = Field(default_factory=dict)
    meta: RunMeta
