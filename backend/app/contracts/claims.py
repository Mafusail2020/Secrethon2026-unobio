from typing import Literal

from pydantic import Field

from app.contracts.common import ClaimLabel, Confidence, Contract, SectionId, Severity

Stance = Literal["pro", "con", "neutral"]
ClaimStatus = Literal["accepted", "rejected", "downgraded"]
SectionStatus = Literal["ok", "partial", "insufficient_evidence"]
TranslationStep = Literal[
    "molecular_effect",
    "human_exposure",
    "target_engagement",
    "biological_response",
    "patient_benefit",
]
TranslationStatus = Literal["supported", "weak", "missing", "contradicted"]
RiskCategory = Literal["efficacy", "safety", "pk_exposure", "commercial", "regulatory", "cmc", "ip"]
DiligenceRequirement = Literal[
    "proprietary_data",
    "patient_level_data",
    "kol_interview",
    "new_experiment",
    "cmc_diligence",
    "ip_diligence",
    "public_research",
]


class Claim(Contract):
    id: str
    text: str
    section: SectionId
    stance: Stance
    label: ClaimLabel
    evidence_ids: list[str] = Field(default_factory=list)
    confidence: Confidence
    produced_by: str
    status: ClaimStatus = "accepted"
    rejection_reason: str | None = None


class KeyPoint(Contract):
    text: str
    claim_ids: list[str] = Field(default_factory=list)


class PanelCandidate(Contract):
    model: str
    summary: str
    decision_hint: str | None = None


class PanelResult(Contract):
    candidates: list[PanelCandidate]
    consensus: str
    disagreements: list[str] = Field(default_factory=list)
    agreement: float = Field(ge=0, le=1)


class SectionResult(Contract):
    section: SectionId
    title: str
    summary: str
    key_points: list[KeyPoint] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    status: SectionStatus
    produced_by: str
    panel: PanelResult | None = None


class TranslationLink(Contract):
    step: TranslationStep
    status: TranslationStatus
    claim_ids: list[str] = Field(default_factory=list)


class Risk(Contract):
    category: RiskCategory
    text: str
    severity: Severity
    claim_ids: list[str] = Field(default_factory=list)


class DiligenceQuestion(Contract):
    question: str
    why_it_matters: str
    requires: list[DiligenceRequirement] = Field(default_factory=list)
    priority: int
    claim_ids: list[str] = Field(default_factory=list)


class PlannedQuestion(Contract):
    id: str
    section: SectionId
    question: str
    rationale: str
    priority: int
