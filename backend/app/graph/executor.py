import time
from typing import Any

from app.contracts import LogLine, NodeExecution, utcnow
from app.graph.context import NodeCtx, RunContext
from app.graph.registry import NodeEntry
from app.graph.state import GraphState, dump_delta, load_delta, union_lists
from app.graph.summary import compact
from app.llm.types import LLMBudgetError


class NodeFailedError(Exception):
    def __init__(self, node_id: str, cause: Exception) -> None:
        super().__init__(f"critical node {node_id} failed: {cause}")
        self.node_id = node_id


async def execute_node(rc: RunContext, entry: NodeEntry, state: GraphState) -> dict[str, Any]:
    """Wraps one node for LangGraph: events, NodeExecution record, fail-soft, replay."""
    spec = entry.spec
    bus, repo = rc.services.bus, rc.services.nodes
    corrections = rc.corrections_for(spec.id)
    base = {
        "run_id": rc.run_id,
        "node_id": spec.id,
        "input_summary": compact({k: state.get(k) for k in spec.reads}),  # type: ignore[misc]
        "correction_ids": [c.id for c in corrections],
    }

    if spec.id in rc.reuse:
        parent = rc.parent_outputs.get(spec.id)
        now = utcnow()
        await repo.save(
            NodeExecution(
                status="reused",
                started_at=now,
                finished_at=now,
                output=parent.output if parent else {},
                source_ids=parent.source_ids if parent else [],
                log=[LogLine(ts=now, level="info", message=f"reused from run {rc.parent_run_id}")],
                **base,
            ),
            rc.reuse[spec.id],
        )
        bus.emit(rc.run_id, "node.reused", spec.id, from_run=rc.parent_run_id)
        return load_delta(rc.reuse[spec.id])

    started_at = utcnow()
    clock = time.monotonic()
    bus.emit(rc.run_id, "node.started", spec.id, correction_ids=base["correction_ids"])
    await repo.save(NodeExecution(status="running", started_at=started_at, **base))

    ctx = NodeCtx(rc, spec, state.get("evidence_ids", []))
    status, error = "done", None
    delta: dict[str, Any] = {}
    dumped: dict[str, Any] = {}
    failure: Exception | None = None
    try:
        assert entry.run is not None, f"{spec.id} has no run function"
        delta = await entry.run(state, ctx)
        undeclared = set(delta) - set(spec.writes)
        if undeclared:
            raise ValueError(f"{spec.id} wrote undeclared state keys: {sorted(undeclared)}")
        for key, ids in (("source_ids", ctx.source_ids), ("evidence_ids", ctx.evidence_ids)):
            if ids:
                delta[key] = union_lists(delta.get(key), ids)
        dumped = dump_delta(delta)
    except LLMBudgetError as exc:
        status, error, delta, dumped = "skipped", str(exc), {}, {}
        ctx.log(f"skipped: {exc}", "warn")
        rc.failed_nodes.append(spec.id)
        bus.emit(rc.run_id, "node.skipped", spec.id, reason="budget", message=str(exc))
    except Exception as exc:
        status, error, delta, dumped, failure = "failed", str(exc), {}, {}, exc
        ctx.log(f"failed: {exc}", "error")
        rc.failed_nodes.append(spec.id)
        bus.emit(rc.run_id, "node.failed", spec.id, error=str(exc)[:500], critical=spec.critical)

    costs = [c.cost_usd for c in ctx.calls if not c.cached]
    execution = NodeExecution(
        status=status,  # type: ignore[arg-type]
        started_at=started_at,
        finished_at=utcnow(),
        output=compact(delta),
        log=ctx.log_lines,
        source_ids=ctx.source_ids,
        llm_calls=ctx.calls,
        cost_usd=None if not costs or any(c is None for c in costs) else sum(costs),  # type: ignore[arg-type]
        error=error,
        **base,
    )
    await repo.save(execution, dumped)
    if failure is not None and spec.critical:
        raise NodeFailedError(spec.id, failure) from failure
    if status == "done":
        bus.emit(
            rc.run_id,
            "node.completed",
            spec.id,
            duration_ms=int((time.monotonic() - clock) * 1000),
            output=execution.output,
        )
    return delta
