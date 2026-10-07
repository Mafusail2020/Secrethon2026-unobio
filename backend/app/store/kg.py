from collections.abc import Collection, Sequence
from typing import Protocol

from pydantic import BaseModel

from app.contracts import EntityRef


class KGEdge(BaseModel):
    source: str
    target: str
    relation: str
    evidence_id: str


class KnowledgeGraph(Protocol):
    async def add_nodes(self, nodes: Sequence[EntityRef]) -> None: ...

    async def add_edges(self, edges: Sequence[KGEdge]) -> None: ...

    async def neighbors(
        self,
        entity_id: str,
        *,
        relation: str | None = None,
        evidence_ids: Collection[str] | None = None,
    ) -> list[KGEdge]: ...
