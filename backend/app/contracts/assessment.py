from typing import Literal

from pydantic import Field, model_validator

from app.contracts.common import Contract
from app.contracts.quant import Basis

AssessedCause = Literal["efficacy", "safety"]
AssessmentRating = Literal["strong", "moderate", "weak", "concerning", "unknown"]


class AssessmentMetric(Contract):
    """One number an assessment computed, with what it means and where it came from."""

    key: str = Field(description="Stable id of the formula output, e.g. genetic_support.")
    label: str
    value: float | None = None
    unit: str | None = None
    note: str | None = Field(default=None, description="One line on what the number says.")
    basis: Basis
    citation: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _sourced_needs_citation(self) -> "AssessmentMetric":
        if self.basis == "sourced" and not self.citation:
            raise ValueError("a sourced metric needs a citation")
        return self


class AssessmentResult(Contract):
    """What the efficacy or safety lane found, in numbers a reader can check.

    The metrics come from formulas; the claims are model-written and gated. The headline is composed
    by code from the metrics, never by a model."""

    cause: AssessedCause
    rating: AssessmentRating
    headline: str
    metrics: list[AssessmentMetric] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(
        default_factory=list, description="What could not be checked, and why. Unknown is valid."
    )
    produced_by: str

    @model_validator(mode="after")
    def _unique_metrics(self) -> "AssessmentResult":
        keys = [m.key for m in self.metrics]
        if len(set(keys)) != len(keys):
            raise ValueError("a metric key appears twice")
        return self
