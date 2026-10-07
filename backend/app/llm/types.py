from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from app.contracts import PanelResult
from app.contracts.program import Effort


class LLMParseError(Exception):
    pass


class LLMBudgetError(Exception):
    pass


@dataclass(frozen=True)
class LLMTask:
    purpose: str
    system: str
    user: str
    schema: type[BaseModel] | None = None
    max_tokens: int = 1024
    temperature: float | None = None


@dataclass
class LLMResult:
    model: str
    text: str
    parsed: BaseModel | None
    tokens_in: int
    tokens_out: int
    cost_usd: float | None
    cached: bool
    latency_ms: int
    panel: PanelResult | None = None


@dataclass(frozen=True)
class EffortKnobs:
    effort: Effort
    retrieval_k: int
    n_queries: int
    max_tokens: int
    tier: str


class LLMClient(Protocol):
    async def complete(self, task: LLMTask) -> LLMResult: ...
