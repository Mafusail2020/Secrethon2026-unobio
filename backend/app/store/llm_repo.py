from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from app.contracts import LLMCallRecord, utcnow
from app.store.db import Database
from app.store.tables import LLMCacheRow, LLMCallRow


class LLMRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def add_call(self, run_id: str, node_id: str, record: LLMCallRecord) -> None:
        async with self.db.session() as s, s.begin():
            s.add(
                LLMCallRow(
                    run_id=run_id,
                    node_id=node_id,
                    model=record.model,
                    purpose=record.purpose,
                    tokens_in=record.tokens_in,
                    tokens_out=record.tokens_out,
                    cost_usd=record.cost_usd,
                    cached=record.cached,
                    latency_ms=record.latency_ms,
                    ts=utcnow(),
                )
            )

    async def calls_for_run(self, run_id: str) -> list[LLMCallRow]:
        async with self.db.session() as s:
            return list(await s.scalars(select(LLMCallRow).where(LLMCallRow.run_id == run_id)))

    async def cache_get(self, key: str) -> dict[str, Any] | None:
        async with self.db.session() as s:
            row = await s.get(LLMCacheRow, key)
            return row.response if row else None

    async def cache_put(self, key: str, model: str, response: dict[str, Any]) -> None:
        async with self.db.session() as s, s.begin():
            row = await s.get(LLMCacheRow, key)
            created: datetime = utcnow()
            if row is None:
                s.add(LLMCacheRow(key=key, model=model, response=response, created_at=created))
            else:
                row.response = response
                row.created_at = created

    async def spend(self) -> dict[str, Any]:
        """Totals over uncached calls, for the team-wide budget."""
        async with self.db.session() as s:
            row = (
                await s.execute(
                    select(
                        func.count(),
                        func.coalesce(func.sum(LLMCallRow.tokens_in), 0),
                        func.coalesce(func.sum(LLMCallRow.tokens_out), 0),
                        func.sum(LLMCallRow.cost_usd),
                    ).where(LLMCallRow.cached.is_(False))
                )
            ).one()
        return {"calls": row[0], "tokens_in": row[1], "tokens_out": row[2], "cost_usd": row[3]}
