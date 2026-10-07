from collections.abc import Sequence

from sqlalchemy import select

from app.contracts import Correction
from app.store.db import Database
from app.store.tables import CorrectionRow


def _correction(row: CorrectionRow) -> Correction:
    return Correction(
        id=row.id,
        run_id=row.run_id,
        node_id=row.node_id,
        text=row.text,
        exclude_evidence_ids=row.exclude_evidence_ids,
        add_links=row.add_links,  # type: ignore[arg-type]
        add_notes=row.add_notes,
        created_at=row.created_at,
    )


class CorrectionsRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(self, correction: Correction) -> None:
        async with self.db.session() as s, s.begin():
            s.add(
                CorrectionRow(
                    id=correction.id,
                    run_id=correction.run_id,
                    node_id=correction.node_id,
                    text=correction.text,
                    exclude_evidence_ids=correction.exclude_evidence_ids,
                    add_links=[str(u) for u in correction.add_links],
                    add_notes=correction.add_notes,
                    created_at=correction.created_at,
                )
            )

    async def get_many(self, ids: Sequence[str]) -> list[Correction]:
        """Same order as ids."""
        if not ids:
            return []
        async with self.db.session() as s:
            rows = await s.scalars(select(CorrectionRow).where(CorrectionRow.id.in_(list(ids))))
            by_id = {r.id: _correction(r) for r in rows}
        return [by_id[i] for i in ids if i in by_id]
