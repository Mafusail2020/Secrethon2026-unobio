from typing import Literal

from pydantic import Field, model_validator

from app.contracts.common import Confidence, Contract, Decision, Range

MatchLevel = Literal[
    "exact_target_indication", "target_area", "target_any", "target_class", "area_base_rate"
]
TwinStatus = Literal["approved", "stopped", "active", "unknown"]
Basis = Literal["sourced", "assumption"]
StopCategory = Literal["efficacy", "safety", "business", "other"]


class TwinProgram(Contract):
    drug: str
    drug_id: str
    disease: str
    max_stage: str
    status: TwinStatus
    stop_reason: str | None = None
    source_ids: list[str] = Field(default_factory=list)


class TwinStats(Contract):
    match_level: MatchLevel
    n_programs: int = Field(ge=0)
    twins: list[TwinProgram] = Field(default_factory=list)
    stage_distribution: dict[str, int] = Field(default_factory=dict)
    stop_reasons: dict[str, int] = Field(default_factory=dict)
    stop_reason_categories: dict[str, StopCategory] = Field(
        default_factory=dict,
        description=(
            "Category of each key in stop_reasons, when the source provides one. "
            "Unmapped reasons are uncategorised."
        ),
    )
    prior_pos: Range
    notes: list[str] = Field(default_factory=list)


class LedgerStep(Contract):
    factor: str
    direction: Literal["up", "down"]
    likelihood_ratio: Range
    basis: Basis
    citation: str | None = None
    claim_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    pos_after: Range | None = Field(
        default=None,
        description=(
            "Probability of success after this step (low, base, high); "
            "the last step equals the posterior."
        ),
    )

    @model_validator(mode="after")
    def _sourced_needs_citation(self) -> "LedgerStep":
        if self.basis == "sourced" and not self.citation:
            raise ValueError("sourced ledger step needs a citation")
        return self


class EvidenceLedger(Contract):
    prior: Range
    steps: list[LedgerStep] = Field(default_factory=list)
    posterior: Range


class Assumption(Contract):
    name: str
    value: Range
    basis: Basis
    citation: str | None = None

    @model_validator(mode="after")
    def _sourced_needs_citation(self) -> "Assumption":
        if self.basis == "sourced" and not self.citation:
            raise ValueError("sourced assumption needs a citation")
        return self


class Valuation(Contract):
    next_milestone: str
    capital_to_milestone: Range
    time_to_milestone_months: Range
    rnpv: Range
    value_inflection_points: list[str] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)


class ReasonCode(Contract):
    code: str
    text: str
    direction: Literal["positive", "negative"]
    claim_ids: list[str] = Field(default_factory=list)


class Verdict(Contract):
    decision: Decision
    confidence: Confidence
    reason_codes: list[ReasonCode] = Field(max_length=5)
    conditions: list[str] = Field(default_factory=list)
    rationale: str
