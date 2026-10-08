from collections.abc import Collection, Sequence
from typing import Protocol

from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.dialects.sqlite import insert

from app.contracts import EntityRef
from app.store.db import Database
from app.store.tables import KGEdgeRow, KGNodeRow


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


class SqliteKnowledgeGraph:
    """Every edge carries the evidence id it was read from; a run filters by its own set."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def add_nodes(self, nodes: Sequence[EntityRef]) -> None:
        if not nodes:
            return
        rows = {
            n.id: {"id": n.id, "kind": n.kind, "label": n.label, "body": n.model_dump(mode="json")}
            for n in nodes
        }
        async with self.db.session() as s, s.begin():
            await s.execute(insert(KGNodeRow).values(list(rows.values())).on_conflict_do_nothing())

    async def add_edges(self, edges: Sequence[KGEdge]) -> None:
        if not edges:
            return
        rows = {(e.source, e.target, e.relation, e.evidence_id): e.model_dump() for e in edges}
        async with self.db.session() as s, s.begin():
            await s.execute(insert(KGEdgeRow).values(list(rows.values())).on_conflict_do_nothing())

    async def neighbors(
        self,
        entity_id: str,
        *,
        relation: str | None = None,
        evidence_ids: Collection[str] | None = None,
    ) -> list[KGEdge]:
        """Edges touching the entity in either direction."""
        stmt = select(KGEdgeRow).where(
            or_(KGEdgeRow.source == entity_id, KGEdgeRow.target == entity_id)
        )
        if relation is not None:
            stmt = stmt.where(KGEdgeRow.relation == relation)
        if evidence_ids is not None:
            stmt = stmt.where(KGEdgeRow.evidence_id.in_(list(evidence_ids)))
        async with self.db.session() as s:
            rows = await s.scalars(stmt)
            return [
                KGEdge(
                    source=r.source, target=r.target, relation=r.relation, evidence_id=r.evidence_id
                )
                for r in rows
            ]
