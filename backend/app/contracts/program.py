from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, HttpUrl, StringConstraints

from app.contracts.common import Contract

Modality = Literal[
    "small_molecule",
    "antibody",
    "biologic_other",
    "cell_therapy",
    "gene_therapy",
    "oligonucleotide",
    "vaccine",
    "other",
]
Stage = Literal[
    "discovery", "preclinical", "ind_enabling", "phase1", "phase2", "phase3", "filed", "approved"
]
Effort = Literal["low", "medium", "high", "panel"]

_Required = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


_OptShort = Annotated[str | None, StringConstraints(max_length=300), AfterValidator(_blank_to_none)]
_OptLong = Annotated[str | None, StringConstraints(max_length=5000), AfterValidator(_blank_to_none)]


DocumentId = Annotated[str, StringConstraints(pattern=r"^doc_[0-9a-f]{16}$")]


class DocumentInfo(Contract):
    """A file the user uploaded before starting a run; the run names it by id."""

    id: DocumentId
    name: Annotated[str, StringConstraints(max_length=200)]
    kind: Literal["pdf", "text"]
    size_bytes: int = Field(ge=0)


class ProgramInput(Contract):
    indication: _Required
    mechanism: _Required
    drug_name: _OptShort = None
    modality: Modality | None = None
    stage: Stage | None = None
    preclinical_results: _OptLong = None
    biomarkers: _OptShort = None
    route: _OptShort = None
    notes: _OptLong = None
    links: list[HttpUrl] = Field(default_factory=list, max_length=20)
    document_ids: list[DocumentId] = Field(default_factory=list, max_length=5)


class RunOptions(Contract):
    effort: Effort = "medium"
    model: str | None = None
    panel_size: int = Field(default=3, ge=2)
    panel_models: list[str] | None = None
    force_refresh: bool = False
    as_of: date | None = None
