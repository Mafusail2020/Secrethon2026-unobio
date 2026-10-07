import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from app.contracts import RunEvent, utcnow
from app.store.events_repo import EventsRepo

log = logging.getLogger(__name__)

TERMINAL_EVENTS = frozenset({"run.completed", "run.failed"})


@dataclass
class Subscription:
    queue: asyncio.Queue[RunEvent]
    # emitted but not yet committed when we subscribed; the DB read cannot see these
    snapshot: list[RunEvent]


class EventBus:
    """Assigns per-run seq, publishes synchronously (so order is call order), persists in order.

    A subscriber registers first, then reads history: every event is either already in the DB,
    in the snapshot, or arrives on the queue, so nothing is lost and a late joiner sees it all.
    """

    def __init__(self, repo: EventsRepo) -> None:
        self._repo = repo
        self._seq: dict[str, int] = {}
        self._unpersisted: dict[str, list[RunEvent]] = {}
        self._subs: dict[str, set[asyncio.Queue[RunEvent]]] = {}
        self._writes: asyncio.Queue[RunEvent] = asyncio.Queue()
        self._writer: asyncio.Task | None = None

    async def start(self) -> None:
        self._writer = asyncio.create_task(self._drain())

    async def stop(self) -> None:
        await self.flush()
        if self._writer:
            self._writer.cancel()
            await asyncio.gather(self._writer, return_exceptions=True)

    async def seed(self, run_id: str) -> None:
        self._seq[run_id] = await self._repo.last_seq(run_id)

    def emit(self, run_id: str, type_: str, node_id: str | None = None, **data: Any) -> RunEvent:
        seq = self._seq.get(run_id, 0) + 1
        self._seq[run_id] = seq
        event = RunEvent(
            seq=seq,
            run_id=run_id,
            ts=utcnow(),
            type=type_,  # type: ignore[arg-type]
            node_id=node_id,
            data=data,
        )
        self._unpersisted.setdefault(run_id, []).append(event)
        for queue in self._subs.get(run_id, ()):
            queue.put_nowait(event)
        self._writes.put_nowait(event)
        return event

    async def flush(self) -> None:
        await self._writes.join()

    def forget(self, run_id: str) -> None:
        """Call after flush when a run is over."""
        self._seq.pop(run_id, None)
        self._unpersisted.pop(run_id, None)

    def subscribe(self, run_id: str) -> Subscription:
        queue: asyncio.Queue[RunEvent] = asyncio.Queue()
        self._subs.setdefault(run_id, set()).add(queue)
        return Subscription(queue, list(self._unpersisted.get(run_id, [])))

    def unsubscribe(self, run_id: str, sub: Subscription) -> None:
        subs = self._subs.get(run_id)
        if subs:
            subs.discard(sub.queue)
            if not subs:
                del self._subs[run_id]

    async def history(self, run_id: str, after_seq: int, sub: Subscription) -> list[RunEvent]:
        merged = {e.seq: e for e in await self._repo.after(run_id, after_seq)}
        for event in sub.snapshot:
            if event.seq > after_seq:
                merged.setdefault(event.seq, event)
        return [merged[s] for s in sorted(merged)]

    async def _drain(self) -> None:
        while True:
            batch = [await self._writes.get()]
            while not self._writes.empty():
                batch.append(self._writes.get_nowait())
            try:
                await self._repo.add_many(batch)
            except Exception:
                log.exception("failed to persist %d run events", len(batch))
            finally:
                for event in batch:
                    pending = self._unpersisted.get(event.run_id)
                    if pending and event in pending:
                        pending.remove(event)
                    self._writes.task_done()
