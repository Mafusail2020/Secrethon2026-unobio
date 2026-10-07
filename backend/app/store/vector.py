from collections.abc import Collection, Sequence
from typing import Protocol

from app.contracts import Evidence


class VectorIndex(Protocol):
    async def add(self, evidence: Sequence[Evidence]) -> None: ...

    async def search(
        self, query: str, *, k: int, evidence_ids: Collection[str] | None = None
    ) -> list[tuple[str, float]]:
        """(evidence_id, score) best first, restricted to evidence_ids when given."""
        ...
