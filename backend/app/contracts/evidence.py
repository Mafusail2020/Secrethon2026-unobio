from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.contracts.common import Confidence, Contract

EntityKind = Literal["disease", "target", "drug", "trial", "paper", "company"]
SourceType = Literal[
    "paper", "preprint", "trial", "label", "approval", "db_record", "filing", "user_provided", "web"
]


class EntityRef(Contract):
    id: str
    label: str
    kind: EntityKind
    external_ids: dict[str, str] = Field(default_factory=dict)


class ResolvedEntities(Contract):
    disease: EntityRef
    target: EntityRef | None = None
    drug: EntityRef | None = None
    therapeutic_areas: list[str] = Field(default_factory=list)
    mechanism_class: str | None = None
    confidence: Confidence
    notes: list[str] = Field(default_factory=list)


class SourceRef(Contract):
    id: str
    type: SourceType
    title: str
    url: str | None = None
    publisher: str
    published_at: datetime | None = None
    retrieved_at: datetime
    identifiers: dict[str, str] = Field(default_factory=dict)


class Evidence(Contract):
    id: str
    source_id: str
    excerpt: str
    locator: str | None = None
    entity_ids: list[str] = Field(default_factory=list)
    kind: Literal["text", "structured"] = "text"
    data: dict[str, Any] | None = None
