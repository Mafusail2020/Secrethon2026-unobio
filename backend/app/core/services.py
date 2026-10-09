from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.core.documents import DocumentStore
from app.core.events import EventBus
from app.core.settings import Settings
from app.llm.factory import LLMStack, build_llm_stack
from app.sources.base import SourceRegistry
from app.sources.factory import build_sources
from app.store import Store
from app.store.chat_repo import ChatRepo
from app.store.corrections_repo import CorrectionsRepo
from app.store.db import Database
from app.store.events_repo import EventsRepo
from app.store.llm_repo import LLMRepo
from app.store.node_exec_repo import NodeExecRepo
from app.store.runs_repo import RunsRepo
from app.store.sqlite_store import build_store

if TYPE_CHECKING:
    from app.graph.runner import RunManager


@dataclass
class Services:
    settings: Settings
    db: Database
    runs: RunsRepo
    events: EventsRepo
    nodes: NodeExecRepo
    corrections: CorrectionsRepo
    chat: ChatRepo
    llm_repo: LLMRepo
    documents: DocumentStore
    bus: EventBus
    llm: LLMStack
    store: Store
    sources: SourceRegistry
    manager: "RunManager"

    async def close(self) -> None:
        await self.manager.shutdown()
        await self.bus.stop()
        await self.sources.aclose()
        await self.db.dispose()


async def build_services(settings: Settings) -> Services:
    from app.graph.runner import RunManager

    db = Database(settings.data_path / "app.db")
    await db.init()
    events = EventsRepo(db)
    llm_repo = LLMRepo(db)
    bus = EventBus(events)
    await bus.start()
    store = await build_store(db, settings.cache_ttl_days)
    services = Services(
        settings=settings,
        db=db,
        runs=RunsRepo(db),
        events=events,
        nodes=NodeExecRepo(db),
        corrections=CorrectionsRepo(db),
        chat=ChatRepo(db),
        llm_repo=llm_repo,
        documents=DocumentStore(settings.data_path / "documents"),
        bus=bus,
        llm=await build_llm_stack(settings, llm_repo),
        store=store,
        sources=build_sources(settings, store.source_cache),
        manager=None,  # type: ignore[arg-type]  set below, it needs the rest
    )
    services.manager = RunManager(services, settings.max_concurrent_runs)
    return services
