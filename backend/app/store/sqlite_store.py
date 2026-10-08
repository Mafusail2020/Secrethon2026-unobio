from dataclasses import dataclass

from app.store.db import Database
from app.store.evidence import SqliteEvidenceStore
from app.store.kg import SqliteKnowledgeGraph
from app.store.source_cache import SqliteSourceCache
from app.store.vector import FtsIndex


@dataclass
class SqliteStore:
    source_cache: SqliteSourceCache
    evidence: SqliteEvidenceStore
    vectors: FtsIndex
    kg: SqliteKnowledgeGraph


async def build_store(db: Database, cache_ttl_days: int) -> SqliteStore:
    """Everything in app.db, so runs, corrections and the evidence drill-down survive restarts."""
    vectors = FtsIndex(db)
    await vectors.init()
    return SqliteStore(
        source_cache=SqliteSourceCache(db, cache_ttl_days),
        evidence=SqliteEvidenceStore(db),
        vectors=vectors,
        kg=SqliteKnowledgeGraph(db),
    )
