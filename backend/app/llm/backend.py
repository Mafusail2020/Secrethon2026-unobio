from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from app.llm.types import LLMTask


@dataclass
class RawCompletion:
    text: str
    parsed: BaseModel | None
    tokens_in: int = 0
    tokens_out: int = 0


class Backend(Protocol):
    cacheable: bool
    is_mock: bool

    async def complete(self, task: LLMTask, model: str) -> RawCompletion: ...
