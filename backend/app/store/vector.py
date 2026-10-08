import re
from collections.abc import Collection, Mapping, Sequence
from typing import Protocol

from sqlalchemy import bindparam, text

from app.contracts import Evidence
from app.store.db import Database


class VectorIndex(Protocol):
    async def add(
        self, evidence: Sequence[Evidence], context: Mapping[str, str] | None = None
    ) -> None:
        """context: evidence id -> extra searchable text (e.g. the source title)."""
        ...

    async def search(
        self, query: str, *, k: int, evidence_ids: Collection[str] | None = None
    ) -> list[tuple[str, float]]:
        """(evidence_id, score) best first, restricted to evidence_ids when given."""
        ...


_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*")
_STOP = {
    *("a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it"),
    *("of", "on", "or", "that", "the", "this", "to", "was", "were", "with", "what", "which"),
    *("does", "do", "did", "how", "why", "will", "would", "can", "could", "evidence"),
}


_PHASE = re.compile(r"\bPHASE_?(\d)\b", re.I)


_PHASE_TERM = re.compile(r"\bphase (\d)\b", re.I)


def index_text(text: str) -> str:
    """CT.gov writes PHASE3 and OT writes PHASE_3; index both as 'phase 3' so queries match."""
    return _PHASE.sub(r"phase \1", text)


def fts_query(query: str) -> str | None:
    """Free text -> an FTS5 OR query of quoted terms, so user punctuation can't break the syntax."""
    normalized = index_text(query)
    phases = [f"phase {n}" for n in _PHASE_TERM.findall(normalized)]
    words = [w.lower() for w in _WORD.findall(normalized) if w.lower() not in _STOP and len(w) > 1]
    terms = list(dict.fromkeys(phases + [w for w in words if w != "phase" or not phases]))[:32]
    return " OR ".join(f'"{t}"' for t in terms) or None


class FtsIndex:
    """BM25 full-text search in SQLite FTS5. Stands where the brief had LanceDB: a run holds a few
    hundred evidence items, so keyword ranking is enough and needs no model download."""

    TABLE = "evidence_fts"

    def __init__(self, db: Database) -> None:
        self.db = db

    async def init(self) -> None:
        async with self.db.engine.begin() as conn:
            await conn.execute(
                text(
                    f"CREATE VIRTUAL TABLE IF NOT EXISTS {self.TABLE} "
                    "USING fts5(evidence_id UNINDEXED, body, tokenize='porter unicode61')"
                )
            )

    async def add(
        self, evidence: Sequence[Evidence], context: Mapping[str, str] | None = None
    ) -> None:
        if not evidence:
            return
        async with self.db.engine.begin() as conn:
            ids = [e.id for e in evidence]
            stmt = text(f"SELECT evidence_id FROM {self.TABLE} WHERE evidence_id IN :ids")
            existing = {
                r[0]
                for r in await conn.execute(
                    stmt.bindparams(bindparam("ids", expanding=True)), {"ids": ids}
                )
            }
            fresh = {e.id: e for e in evidence if e.id not in existing}
            if fresh:
                await conn.execute(
                    text(f"INSERT INTO {self.TABLE} (evidence_id, body) VALUES (:id, :body)"),
                    [
                        {
                            "id": e.id,
                            "body": index_text(f"{(context or {}).get(e.id, '')} {e.excerpt}"),
                        }
                        for e in fresh.values()
                    ],
                )

    async def search(
        self, query: str, *, k: int, evidence_ids: Collection[str] | None = None
    ) -> list[tuple[str, float]]:
        match = fts_query(query)
        if match is None or (evidence_ids is not None and not evidence_ids):
            return []
        restrict = " AND evidence_id IN :ids" if evidence_ids is not None else ""
        stmt = text(
            f"SELECT evidence_id, bm25({self.TABLE}) AS rank FROM {self.TABLE} "
            f"WHERE {self.TABLE} MATCH :match{restrict} ORDER BY rank LIMIT :k"
        )
        params: dict[str, object] = {"match": match, "k": k}
        if evidence_ids is not None:
            stmt = stmt.bindparams(bindparam("ids", expanding=True))
            params["ids"] = list(evidence_ids)
        async with self.db.engine.connect() as conn:
            rows = await conn.execute(stmt, params)
            # bm25 is negative, more negative = better; flip it so higher is better
            return [(r[0], -float(r[1])) for r in rows]
