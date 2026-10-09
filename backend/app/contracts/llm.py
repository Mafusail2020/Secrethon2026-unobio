from typing import Literal

from pydantic import Field

from app.contracts.common import Contract

ModelTier = Literal["cheap", "standard", "premium", "unknown"]
ChatRole = Literal["user", "assistant"]


class ModelInfo(Contract):
    id: str
    label: str
    tier: ModelTier
    price_in_per_mtok: float | None = None
    price_out_per_mtok: float | None = None
    available: bool
    default: bool = False


class ChatMessage(Contract):
    role: ChatRole
    content: str
    run_id: str | None = None
    cited_claim_ids: list[str] = Field(default_factory=list)
    # passages of the user's uploaded files the answer rests on (evidence ids)
    cited_evidence_ids: list[str] = Field(default_factory=list)
