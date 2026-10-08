from typing import Literal, get_args

from pydantic import Field, model_validator

from app.contracts.common import Confidence, Contract, Decision, Range

MatchLevel = Literal[
    "exact_target_indication", "target_area", "target_any", "target_class", "area_base_rate"
]
TwinStatus = Literal["approved", "stopped", "active", "unknown"]
Basis = Literal["sourced", "assumption"]
StopCategory = Literal["efficacy", "safety", "business", "other"]
FailureCause = Literal["efficacy", "safety", "pk_exposure", "commercial", "other"]
FAILURE_CAUSES: tuple[str, ...] = get_args(FailureCause)


class CauseShare(Contract):
    cause: FailureCause
    share: Range = Field(
        description="Fraction of all failures this cause explains (low, base, high); unit 'share'."
    )


class FailureMix(Contract):
    """Where a program's failure probability goes, by cause.

    Taken from the stop reasons of stopped twin programs when there are enough of them, otherwise
    from the literature figures in config/ledger.yaml. The ledger splits the prior's failure
    budget with it, so each kind of evidence can move only the risk it speaks to."""

    shares: list[CauseShare]
    source: Literal["twins", "literature"]
    n_stopped: int = Field(
        default=0, ge=0, description="Stopped twin programs behind the shares; 0 for literature."
    )
    basis: Basis
    citation: str | None = None
    note: str | None = None

    @model_validator(mode="after")
    def _valid_mix(self) -> "FailureMix":
        causes = [s.cause for s in self.shares]
        if len(set(causes)) != len(causes):
            raise ValueError("a cause appears twice in the failure mix")
        if abs(sum(s.share.base for s in self.shares) - 1) > 0.02:
            raise ValueError("the base shares of a failure mix must sum to 1 (within 0.02)")
        if self.basis == "sourced" and not self.citation:
            raise ValueError("a sourced failure mix needs a citation")
        return self


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
    failure_mix: FailureMix | None = Field(
        default=None, description="Failure causes among the stopped twins, or the literature split."
    )
    notes: list[str] = Field(default_factory=list)


class RiskAdjustment(Contract):
    """One piece of evidence that moves one cause's risk.

    Written by the assessment lanes (any node may add one) and applied by evidence_ledger:
    the cause's cumulative hazard is multiplied by risk_ratio. Below 1 lowers that risk."""

    cause: FailureCause
    factor: str
    risk_ratio: Range = Field(
        description="Multiplier on the cause's hazard; low = optimistic, high = pessimistic."
    )
    basis: Basis
    citation: str | None = None
    inputs: dict[str, float | int | str | None] = Field(
        default_factory=dict,
        description="The numbers the formula used, so a reader can recompute the ratio.",
    )
    claim_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _valid(self) -> "RiskAdjustment":
        if self.basis == "sourced" and not self.citation:
            raise ValueError("a sourced risk adjustment needs a citation")
        if self.risk_ratio.low <= 0:
            raise ValueError("a risk ratio must be positive")
        return self


class LedgerStep(Contract):
    factor: str
    cause: FailureCause
    direction: Literal["up", "down"] = Field(
        description="Effect on the probability of success: up lowers the cause's risk (ratio <= 1)."
    )
    risk_ratio: Range
    basis: Basis
    citation: str | None = None
    claim_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    pos_after: Range = Field(
        description=(
            "Probability of success after this step (low, base, high); "
            "the last step equals the posterior."
        )
    )

    @model_validator(mode="after")
    def _valid(self) -> "LedgerStep":
        if self.basis == "sourced" and not self.citation:
            raise ValueError("sourced ledger step needs a citation")
        base = self.risk_ratio.base
        if (self.direction == "up" and base > 1) or (self.direction == "down" and base < 1):
            raise ValueError("direction disagrees with the risk ratio")
        return self


class CauseOutcome(Contract):
    cause: FailureCause
    share: Range
    hazard_prior: Range
    hazard_posterior: Range
    risk_ratio: Range = Field(description="Net multiplier of every adjustment to this cause.")


class EvidenceLedger(Contract):
    """prior -> posterior, by cause.

    H = -ln(prior); each cause i gets H_i = share_i * H; adjustments multiply H_i by their
    risk_ratio; posterior = exp(-sum(H_i)). The low end of every range is the pessimistic one
    (a lower prior, higher risk ratios), the high end the optimistic one."""

    prior: Range
    failure_mix: FailureMix | None = None
    steps: list[LedgerStep] = Field(default_factory=list)
    by_cause: list[CauseOutcome] = Field(default_factory=list)
    posterior: Range

    @model_validator(mode="after")
    def _posterior_is_the_last_step(self) -> "EvidenceLedger":
        if self.steps and any(
            abs(getattr(self.posterior, k) - getattr(self.steps[-1].pos_after, k)) > 1e-4
            for k in ("low", "base", "high")
        ):
            raise ValueError("the posterior must equal the last step's pos_after")
        return self


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
    cause: FailureCause | None = Field(
        default=None, description="The failure cause this reason speaks to, when it is about one."
    )
    claim_ids: list[str] = Field(default_factory=list)


class Verdict(Contract):
    decision: Decision
    confidence: Confidence
    reason_codes: list[ReasonCode] = Field(max_length=5)
    conditions: list[str] = Field(default_factory=list)
    rationale: str
