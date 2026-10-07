import asyncio

import pytest

from app.core.events import EventBus
from app.store.db import Database
from app.store.events_repo import EventsRepo


@pytest.fixture
async def bus(tmp_path):
    db = Database(tmp_path / "t.db")
    await db.init()
    bus = EventBus(EventsRepo(db))
    await bus.start()
    yield bus
    await bus.stop()
    await db.dispose()


async def test_seq_is_per_run_and_persisted_in_order(bus: EventBus):
    for i in range(5):
        bus.emit("r1", "node.log", "n", message=str(i))
    bus.emit("r2", "run.started")
    await bus.flush()
    sub = bus.subscribe("r1")
    events = await bus.history("r1", 0, sub)
    assert [e.seq for e in events] == [1, 2, 3, 4, 5]
    assert [e.data["message"] for e in events] == ["0", "1", "2", "3", "4"]
    assert [e.seq for e in await bus.history("r2", 0, bus.subscribe("r2"))] == [1]


async def test_history_after_last_event_id(bus: EventBus):
    for _ in range(4):
        bus.emit("r1", "node.log", "n")
    await bus.flush()
    events = await bus.history("r1", 2, bus.subscribe("r1"))
    assert [e.seq for e in events] == [3, 4]


async def test_late_subscriber_misses_nothing_while_writes_are_pending(bus: EventBus):
    bus.emit("r1", "run.started")
    bus.emit("r1", "node.started", "a")
    sub = bus.subscribe("r1")  # before the writer has run: these two are only in the snapshot
    bus.emit("r1", "node.completed", "a")
    history = await bus.history("r1", 0, sub)
    live = []
    while not sub.queue.empty():
        live.append(sub.queue.get_nowait())
    seen = {e.seq: e for e in [*history, *live]}
    assert sorted(seen) == [1, 2, 3]


async def test_live_subscriber_gets_events_in_order(bus: EventBus):
    sub = bus.subscribe("r1")
    for i in range(3):
        bus.emit("r1", "node.log", "n", message=str(i))
    got = [await asyncio.wait_for(sub.queue.get(), 1) for _ in range(3)]
    assert [e.seq for e in got] == [1, 2, 3]
    bus.unsubscribe("r1", sub)
    bus.emit("r1", "node.log", "n")
    assert sub.queue.empty()


async def test_seed_continues_numbering_after_restart(bus: EventBus):
    bus.emit("r1", "run.started")
    bus.emit("r1", "node.log", "n")
    await bus.flush()
    bus.forget("r1")
    await bus.seed("r1")
    assert bus.emit("r1", "run.failed").seq == 3
