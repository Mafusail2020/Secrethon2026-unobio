from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.contracts import RunEvent
from app.graph.registry import get_registry
from app.graph.topology import EDGES, runnable_ids

OUT = (
    Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "events_bace1_alzheimers.jsonl"
)
RUN_ID = "run_fixture_bace1_ad"
START = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)


def _layers() -> list[list[str]]:
    remaining = set(runnable_ids())
    done: set[str] = set()
    layers: list[list[str]] = []
    while remaining:
        layer = [
            n
            for n in runnable_ids()
            if n in remaining and all(s in done for s, t in EDGES if t == n)
        ]
        layers.append(layer)
        done |= set(layer)
        remaining -= set(layer)
    return layers


def build_events() -> list[RunEvent]:
    registry = get_registry()
    events: list[RunEvent] = []

    def emit(type_: str, node_id: str | None = None, **data: object) -> None:
        seq = len(events) + 1
        events.append(
            RunEvent(
                seq=seq,
                run_id=RUN_ID,
                ts=START + timedelta(milliseconds=400 * seq),
                type=type_,  # type: ignore[arg-type]
                node_id=node_id,
                data=data,
            )
        )

    emit("run.started", effort="medium", synthetic=True)
    for layer in _layers():
        for node_id in layer:
            emit("node.started", node_id)
        for node_id in layer:
            emit("node.log", node_id, level="info", message=f"FIXTURE: {node_id} started")
            if registry[node_id].spec.kind in ("analysis", "knowledge"):
                emit(
                    "llm.call",
                    node_id,
                    model="mock",
                    purpose=f"{node_id}.fixture",
                    tokens_in=0,
                    tokens_out=0,
                    cost_usd=None,
                    cached=False,
                    latency_ms=0,
                )
            emit("node.log", node_id, level="info", message=f"FIXTURE: {node_id} finished")
        for node_id in layer:
            emit("node.completed", node_id, duration_ms=400, output={})
    emit("run.completed", decision="conditional")
    return events


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    lines = [e.model_dump_json() for e in build_events()]
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {len(lines)} events to {OUT}")


if __name__ == "__main__":
    main()
