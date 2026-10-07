"""In-memory stand-ins so the stub graph runs. Person B replaces them with real stores."""

import re
import time
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.contracts import CaseStance, EntityRef, Evidence, SourceRef
from app.store.kg import KGEdge

_WORD = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


class InMemorySourceCache:
    def __init__(self, default_ttl_days: int = 7) -> None:
        self._ttl = default_ttl_days
        self._items: dict[str, tuple[Any, float]] = {}

    async def get(self, key: str, *, force_refresh: bool = False) -> Any | None:
        if force_refresh:
            return None
        entry = self._items.get(key)
        if entry is None or entry[1] < time.time():
            return None
        return entry[0]

    async def put(self, key: str, value: Any, *, ttl_days: int | None = None) -> None:
        self._items[key] = (value, time.time() + 86400 * (ttl_days or self._ttl))


class InMemoryEvidenceStore:
    def __init__(self) -> None:
        self._sources: dict[str, SourceRef] = {}
        self._evidence: dict[str, Evidence] = {}

    async def put_sources(self, sources: Sequence[SourceRef]) -> None:
        for source in sources:
            self._sources[source.id] = source

    async def put_evidence(self, evidence: Sequence[Evidence]) -> None:
        for item in evidence:
            self._evidence[item.id] = item

    async def get_source(self, source_id: str) -> SourceRef | None:
        return self._sources.get(source_id)

    async def get_evidence(self, evidence_id: str) -> Evidence | None:
        return self._evidence.get(evidence_id)

    async def get_sources(self, source_ids: Sequence[str]) -> list[SourceRef]:
        return [self._sources[i] for i in source_ids if i in self._sources]

    async def get_many_evidence(self, evidence_ids: Sequence[str]) -> list[Evidence]:
        return [self._evidence[i] for i in evidence_ids if i in self._evidence]


class InMemoryVectorIndex:
    """Word-overlap scoring; stands in for LanceDB."""

    def __init__(self) -> None:
        self._docs: dict[str, set[str]] = {}

    async def add(self, evidence: Sequence[Evidence]) -> None:
        for item in evidence:
            self._docs[item.id] = _tokens(item.excerpt)

    async def search(
        self, query: str, *, k: int, evidence_ids: Collection[str] | None = None
    ) -> list[tuple[str, float]]:
        wanted = _tokens(query)
        scored = [
            (doc_id, len(wanted & tokens) / (len(wanted) or 1))
            for doc_id, tokens in self._docs.items()
            if evidence_ids is None or doc_id in evidence_ids
        ]
        return sorted(scored, key=lambda x: (-x[1], x[0]))[:k]


class InMemoryKnowledgeGraph:
    def __init__(self) -> None:
        self._nodes: dict[str, EntityRef] = {}
        self._edges: dict[str, list[KGEdge]] = defaultdict(list)

    async def add_nodes(self, nodes: Sequence[EntityRef]) -> None:
        for node in nodes:
            self._nodes[node.id] = node

    async def add_edges(self, edges: Sequence[KGEdge]) -> None:
        for edge in edges:
            self._edges[edge.source].append(edge)

    async def neighbors(
        self,
        entity_id: str,
        *,
        relation: str | None = None,
        evidence_ids: Collection[str] | None = None,
    ) -> list[KGEdge]:
        return [
            e
            for e in self._edges.get(entity_id, [])
            if (relation is None or e.relation == relation)
            and (evidence_ids is None or e.evidence_id in evidence_ids)
        ]


@dataclass
class InMemoryStore:
    source_cache: InMemorySourceCache = field(default_factory=InMemorySourceCache)
    evidence: InMemoryEvidenceStore = field(default_factory=InMemoryEvidenceStore)
    vectors: InMemoryVectorIndex = field(default_factory=InMemoryVectorIndex)
    kg: InMemoryKnowledgeGraph = field(default_factory=InMemoryKnowledgeGraph)


class RunRetriever:
    """Retriever bound to a run's frozen evidence set; falls back to set order on no match."""

    def __init__(self, store: InMemoryStore, allowed: Collection[str]) -> None:
        self._store = store
        self._allowed = list(allowed)

    async def retrieve(
        self,
        query: str,
        entity_ids: Sequence[str] = (),
        stance: CaseStance | None = None,
        k: int = 8,
    ) -> list[Evidence]:
        if not self._allowed:
            return []
        hits = await self._store.vectors.search(query, k=k, evidence_ids=set(self._allowed))
        ids = [i for i, score in hits if score > 0] or self._allowed[:k]
        return await self._store.evidence.get_many_evidence(ids)
