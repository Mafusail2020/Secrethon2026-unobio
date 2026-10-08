from collections.abc import Collection, Sequence
from typing import Protocol

from app.contracts import CaseStance, Evidence
from app.store.evidence import EvidenceStore
from app.store.kg import KnowledgeGraph
from app.store.vector import VectorIndex

KG_BOOST = 1.5
KG_HOP_BOOST = 1.25


class Retriever(Protocol):
    """Bound to one run: only evidence in that run's set, minus lineage exclusions, is returned."""

    async def retrieve(
        self,
        query: str,
        entity_ids: Sequence[str] = (),
        stance: CaseStance | None = None,
        k: int = 8,
    ) -> list[Evidence]: ...


class _Stores(Protocol):
    evidence: EvidenceStore
    vectors: VectorIndex
    kg: KnowledgeGraph


class RunRetriever:
    """Full-text ranking over the run's frozen evidence set; evidence the knowledge graph links
    to the requested entities ranks higher. Falls back to set order when nothing matches."""

    def __init__(self, store: _Stores, allowed: Collection[str]) -> None:
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
        allowed = set(self._allowed)
        hits = await self._store.vectors.search(query, k=3 * k, evidence_ids=allowed)
        scores = {i: s for i, s in hits if s > 0}
        if entity_ids and scores:
            boost = await self._kg_boost(entity_ids, allowed)
            scores = {i: s * boost.get(i, 1.0) for i, s in scores.items()}
        ranked = sorted(scores, key=lambda i: (-scores[i], i))[:k]
        return await self._store.evidence.get_many_evidence(ranked or self._allowed[:k])

    async def _kg_boost(self, entity_ids: Sequence[str], allowed: set[str]) -> dict[str, float]:
        """Evidence on an edge touching the entity, or one hop further (target -> drug -> trial)."""
        boost: dict[str, float] = {}
        hop: set[str] = set()
        for entity in entity_ids:
            for edge in await self._store.kg.neighbors(entity, evidence_ids=allowed):
                boost[edge.evidence_id] = KG_BOOST
                hop.add(edge.target if edge.source == entity else edge.source)
        for node in hop - set(entity_ids):
            for edge in await self._store.kg.neighbors(node, evidence_ids=allowed):
                boost.setdefault(edge.evidence_id, KG_HOP_BOOST)
        return boost
