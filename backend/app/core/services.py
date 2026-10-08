from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.core.events import EventBus
from app.core.settings import Settings
from app.llm.factory import LLMStack, build_llm_stack
from app.sources.base import SourceRegistry
from app.store.chat_repo import ChatRepo
from app.store.corrections_repo import CorrectionsRepo
from app.store.db import Database
from app.store.events_repo import EventsRepo
from app.store.fakes import InMemoryStore
from app.store.llm_repo import LLMRepo
from app.store.node_exec_repo import NodeExecRepo
from app.store.runs_repo import RunsRepo

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
    bus: EventBus
    llm: LLMStack
    store: InMemoryStore
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
    services = Services(
        settings=settings,
        db=db,
        runs=RunsRepo(db),
        events=events,
        nodes=NodeExecRepo(db),
        corrections=CorrectionsRepo(db),
        chat=ChatRepo(db),
        llm_repo=llm_repo,
        bus=bus,
        llm=await build_llm_stack(settings, llm_repo),
        store=InMemoryStore(),
        sources=SourceRegistry(),
        manager=None,  # type: ignore[arg-type]  set below, it needs the rest
    )
    services.manager = RunManager(services, settings.max_concurrent_runs)
    return services
