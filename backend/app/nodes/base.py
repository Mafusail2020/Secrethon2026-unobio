from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Protocol

from app.contracts import Correction, Evidence, LogLevel, SourceRef
from app.graph.state import GraphState
from app.llm.types import EffortKnobs, LLMClient
from app.sources.base import SourceRegistry
from app.store import Retriever, Store


class NodeContext(Protocol):
    run_id: str
    node_id: str
    effort: EffortKnobs
    llm: LLMClient
    sources: SourceRegistry
    store: Store
    retriever: Retriever

    def log(self, message: str, level: LogLevel = "info") -> None: ...

    def progress(self, message: str) -> None: ...

    def corrections_for(self, node_id: str | None = None) -> list[Correction]:
        """Corrections attached to node_id (default: this node) anywhere in the run lineage."""
        ...

    async def register_sources(self, sources: Sequence[SourceRef]) -> list[str]:
        """Persist sources; the runner adds the returned ids to the node's state delta."""
        ...

    async def register_evidence(self, evidence: Sequence[Evidence]) -> list[str]: ...


NodeRun = Callable[[GraphState, NodeContext], Awaitable[dict[str, Any]]]
