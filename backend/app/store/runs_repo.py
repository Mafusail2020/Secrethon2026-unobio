from dataclasses import dataclass

from sqlalchemy import select, update

from app.contracts import ProgramInput, RunOptions, RunSummary, UnderwritingReport
from app.core.legacy_report import upgrade_report
from app.store.db import Database
from app.store.tables import RunRow


@dataclass(frozen=True)
class LineageEntry:
    run_id: str
    parent_run_id: str | None
    correction_id: str | None


def _summary(row: RunRow) -> RunSummary:
    return RunSummary(
        id=row.id,
        status=row.status,  # type: ignore[arg-type]
        program=ProgramInput.model_validate(row.program),
        options=RunOptions.model_validate(row.options),
        created_at=row.created_at,
        parent_run_id=row.parent_run_id,
        decision=row.decision,  # type: ignore[arg-type]
        error=row.error,
    )


class RunsRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(self, summary: RunSummary, *, correction_id: str | None = None) -> None:
        async with self.db.session() as s, s.begin():
            s.add(
                RunRow(
                    id=summary.id,
                    status=summary.status,
                    program=summary.program.model_dump(mode="json"),
                    options=summary.options.model_dump(mode="json"),
                    created_at=summary.created_at,
                    parent_run_id=summary.parent_run_id,
                    correction_id=correction_id,
                )
            )

    async def get(self, run_id: str) -> RunSummary | None:
        async with self.db.session() as s:
            row = await s.get(RunRow, run_id)
            return _summary(row) if row else None

    async def recent(self, limit: int = 50) -> list[RunSummary]:
        async with self.db.session() as s:
            rows = await s.scalars(select(RunRow).order_by(RunRow.created_at.desc()).limit(limit))
            return [_summary(r) for r in rows]

    async def set_status(
        self,
        run_id: str,
        status: str,
        *,
        error: str | None = None,
        decision: str | None = None,
    ) -> None:
        values: dict = {"status": status}
        if error is not None:
            values["error"] = error
        if decision is not None:
            values["decision"] = decision
        async with self.db.session() as s, s.begin():
            await s.execute(update(RunRow).where(RunRow.id == run_id).values(**values))

    async def save_report(self, run_id: str, report: UnderwritingReport) -> None:
        async with self.db.session() as s, s.begin():
            await s.execute(
                update(RunRow)
                .where(RunRow.id == run_id)
                .values(report=report.model_dump(mode="json"), decision=report.verdict.decision)
            )

    async def get_report(self, run_id: str) -> UnderwritingReport | None:
        async with self.db.session() as s:
            row = await s.get(RunRow, run_id)
            if row is None or row.report is None:
                return None
            return UnderwritingReport.model_validate(upgrade_report(row.report))

    async def lineage(self, run_id: str) -> list[LineageEntry]:
        """Root first, ending with run_id."""
        chain: list[LineageEntry] = []
        async with self.db.session() as s:
            current: str | None = run_id
            while current is not None:
                row = await s.get(RunRow, current)
                if row is None:
                    break
                chain.append(LineageEntry(row.id, row.parent_run_id, row.correction_id))
                current = row.parent_run_id
        return chain[::-1]

    async def document_ids_in_use(self) -> set[str]:
        """Every uploaded file any run (original or re-run) was given."""
        async with self.db.session() as s:
            programs = await s.scalars(select(RunRow.program))
            return {d for p in programs for d in (p or {}).get("document_ids", [])}

    async def mark_interrupted(self) -> list[str]:
        async with self.db.session() as s, s.begin():
            ids = list(
                await s.scalars(select(RunRow.id).where(RunRow.status.in_(["queued", "running"])))
            )
            if ids:
                await s.execute(
                    update(RunRow)
                    .where(RunRow.id.in_(ids))
                    .values(status="failed", error="server restarted before the run finished")
                )
            return ids
