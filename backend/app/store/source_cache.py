from datetime import timedelta
from typing import Any, Protocol

from sqlalchemy.dialects.sqlite import insert

from app.contracts import utcnow
from app.store.db import Database
from app.store.tables import SourceCacheRow


class SourceCache(Protocol):
    async def get(self, key: str, *, force_refresh: bool = False) -> Any | None:
        """None on miss, expired entry or force_refresh."""
        ...

    async def put(self, key: str, value: Any, *, ttl_days: int | None = None) -> None: ...


class SqliteSourceCache:
    """Raw API responses keyed by source + normalized request. Survives restarts, so demo runs
    replay without the network."""

    def __init__(self, db: Database, default_ttl_days: int = 7) -> None:
        self.db = db
        self._ttl = default_ttl_days

    async def get(self, key: str, *, force_refresh: bool = False) -> Any | None:
        if force_refresh:
            return None
        async with self.db.session() as s:
            row = await s.get(SourceCacheRow, key)
            if row is None or row.expires_at <= utcnow():
                return None
            return row.value

    async def put(self, key: str, value: Any, *, ttl_days: int | None = None) -> None:
        now = utcnow()
        expires = now + timedelta(days=ttl_days or self._ttl)
        source = key.split(":", 1)[0]
        # one atomic upsert: fetch nodes run in parallel and cache the same request (target drugs
        # from opentargets, regulatory and safety), so read-then-insert raced on the primary key
        stmt = insert(SourceCacheRow).values(
            key=key, source=source, value=value, created_at=now, expires_at=expires
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[SourceCacheRow.key],
            set_={"value": value, "created_at": now, "expires_at": expires},
        )
        async with self.db.session() as s, s.begin():
            await s.execute(stmt)
