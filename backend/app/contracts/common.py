from datetime import UTC, datetime
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


def utcnow() -> datetime:
    return datetime.now(UTC)


Confidence = Literal["low", "medium", "high"]
Severity = Literal["low", "medium", "high"]
ClaimLabel = Literal["extracted", "derived", "inferred", "modeled", "hypothesis", "unknown"]
CaseStance = Literal["bull", "bear"]
Decision = Literal["invest", "conditional", "do_not_invest"]
LogLevel = Literal["debug", "info", "warn", "error"]

SectionId = Literal[
    "disease_need",
    "scientific_thesis",
    "translation",
    "clinical_plan",
    "competition",
    "commercial_adoption",
    "capital",
    "risks",
]
SECTION_IDS: tuple[str, ...] = get_args(SectionId)


class Range(Contract):
    low: float
    base: float
    high: float
    unit: str = ""

    @model_validator(mode="after")
    def _ordered(self) -> "Range":
        if not self.low <= self.base <= self.high:
            raise ValueError("range must satisfy low <= base <= high")
        return self
