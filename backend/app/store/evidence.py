from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert

from app.contracts import Evidence, SourceRef
from app.store.db import Database
from app.store.tables import EvidenceRow, SourceRow

FIXTURE_MARK = "FIXTURE:"


class EvidenceStore(Protocol):
    async def put_sources(self, sources: Sequence[SourceRef]) -> None: ...

    async def put_evidence(self, evidence: Sequence[Evidence]) -> None: ...

    async def get_source(self, source_id: str) -> SourceRef | None: ...

    async def get_evidence(self, evidence_id: str) -> Evidence | None: ...

    async def get_sources(self, source_ids: Sequence[str]) -> list[SourceRef]: ...

    async def get_many_evidence(self, evidence_ids: Sequence[str]) -> list[Evidence]: ...


class SqliteEvidenceStore:
    """Ids are content-addressed, so a row never changes once written: first write wins.
    Persisting them is what lets a correction replay an old run after a restart."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def put_sources(self, sources: Sequence[SourceRef]) -> None:
        if not sources:
            return
        rows = [{"id": s.id, "type": s.type, "body": s.model_dump(mode="json")} for s in sources]
        stmt = insert(SourceRow).values(rows)
        # stub nodes still register fixture copies of real trials under the same id; a real
        # record replaces a fixture one, never the other way round
        stmt = stmt.on_conflict_do_update(
            index_elements=[SourceRow.id],
            set_={"type": stmt.excluded.type, "body": stmt.excluded.body},
            where=func.json_extract(SourceRow.body, "$.title").like(f"{FIXTURE_MARK}%")
            & func.json_extract(stmt.excluded.body, "$.title").not_like(f"{FIXTURE_MARK}%"),
        )
        async with self.db.session() as s, s.begin():
            await s.execute(stmt)

    async def put_evidence(self, evidence: Sequence[Evidence]) -> None:
        if not evidence:
            return
        rows = [
            {"id": e.id, "source_id": e.source_id, "body": e.model_dump(mode="json")}
            for e in evidence
        ]
        async with self.db.session() as s, s.begin():
            await s.execute(insert(EvidenceRow).values(rows).on_conflict_do_nothing())

    async def get_source(self, source_id: str) -> SourceRef | None:
        found = await self.get_sources([source_id])
        return found[0] if found else None

    async def get_evidence(self, evidence_id: str) -> Evidence | None:
        found = await self.get_many_evidence([evidence_id])
        return found[0] if found else None

    async def get_sources(self, source_ids: Sequence[str]) -> list[SourceRef]:
        async with self.db.session() as s:
            rows = await s.scalars(select(SourceRow).where(SourceRow.id.in_(list(source_ids))))
            by_id = {r.id: SourceRef.model_validate(r.body) for r in rows}
        return [by_id[i] for i in source_ids if i in by_id]

    async def get_many_evidence(self, evidence_ids: Sequence[str]) -> list[Evidence]:
        async with self.db.session() as s:
            rows = await s.scalars(
                select(EvidenceRow).where(EvidenceRow.id.in_(list(evidence_ids)))
            )
            by_id = {r.id: Evidence.model_validate(r.body) for r in rows}
        return [by_id[i] for i in evidence_ids if i in by_id]
