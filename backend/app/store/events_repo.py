from collections.abc import Sequence

from sqlalchemy import func, select

from app.contracts import RunEvent
from app.store.db import Database
from app.store.tables import RunEventRow


def _event(row: RunEventRow) -> RunEvent:
    return RunEvent(
        seq=row.seq,
        run_id=row.run_id,
        ts=row.ts,
        type=row.type,  # type: ignore[arg-type]
        node_id=row.node_id,
        data=row.data,
    )


class EventsRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def add_many(self, events: Sequence[RunEvent]) -> None:
        if not events:
            return
        async with self.db.session() as s, s.begin():
            s.add_all(
                RunEventRow(
                    run_id=e.run_id,
                    seq=e.seq,
                    ts=e.ts,
                    type=e.type,
                    node_id=e.node_id,
                    data=e.data,
                )
                for e in events
            )

    async def last_seq(self, run_id: str) -> int:
        async with self.db.session() as s:
            value = await s.scalar(
                select(func.max(RunEventRow.seq)).where(RunEventRow.run_id == run_id)
            )
            return value or 0

    async def last_event(self, run_id: str) -> RunEvent | None:
        async with self.db.session() as s:
            row = await s.scalar(
                select(RunEventRow)
                .where(RunEventRow.run_id == run_id)
                .order_by(RunEventRow.seq.desc())
                .limit(1)
            )
            return _event(row) if row else None

    async def after(self, run_id: str, seq: int = 0) -> list[RunEvent]:
        async with self.db.session() as s:
            rows = await s.scalars(
                select(RunEventRow)
                .where(RunEventRow.run_id == run_id, RunEventRow.seq > seq)
                .order_by(RunEventRow.seq)
            )
            return [_event(r) for r in rows]
