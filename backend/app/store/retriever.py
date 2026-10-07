from collections.abc import Sequence
from typing import Protocol

from app.contracts import CaseStance, Evidence


class Retriever(Protocol):
    """Bound to one run: only evidence in that run's set, minus lineage exclusions, is returned."""

    async def retrieve(
        self,
        query: str,
        entity_ids: Sequence[str] = (),
        stance: CaseStance | None = None,
        k: int = 8,
    ) -> list[Evidence]: ...
