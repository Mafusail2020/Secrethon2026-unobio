from typing import Protocol

from app.store.evidence import EvidenceStore
from app.store.kg import KGEdge, KnowledgeGraph
from app.store.retriever import Retriever
from app.store.source_cache import SourceCache
from app.store.vector import VectorIndex


class Store(Protocol):
    source_cache: SourceCache
    evidence: EvidenceStore
    vectors: VectorIndex
    kg: KnowledgeGraph


__all__ = [
    "EvidenceStore",
    "KGEdge",
    "KnowledgeGraph",
    "Retriever",
    "SourceCache",
    "Store",
    "VectorIndex",
]
