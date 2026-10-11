import asyncio
import logging
import time
from typing import TYPE_CHECKING

from app.contracts import LLMCallRecord, RunSummary, UnderwritingReport
from app.graph.builder import get_graph
from app.graph.context import RunContext
from app.graph.pace import hold_per_step
from app.graph.replay import affected_set
from app.graph.topology import runnable_ids
from app.llm.budget import RunBudget
from app.llm.node_llm import RunLLM

if TYPE_CHECKING:
    from app.core.services import Services

log = logging.getLogger(__name__)


class RunManager:
    """Runs execute as background tasks, at most `concurrency` at a time."""

    def __init__(self, services: "Services", concurrency: int = 2) -> None:
        self._services = services
        self._sem = asyncio.Semaphore(concurrency)
        self._tasks: set[asyncio.Task] = set()

    def submit(self, run_id: str) -> None:
        task = asyncio.create_task(self._run(run_id), name=f"run-{run_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def wait_idle(self) -> None:
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def shutdown(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _run(self, run_id: str) -> None:
        async with self._sem:
            await execute_run(self._services, run_id)


def _finalize(
    report: UnderwritingReport, summary: RunSummary, rc: RunContext, duration_s: float
) -> UnderwritingReport:
    spent = [c for c in rc.calls if not c.cached]
    cost = _total_cost(spent)
    options = summary.options
    meta = report.meta.model_copy(
        update={
            "models_used": sorted({c.model for c in rc.calls}),
            "effort": options.effort,
            "panel_size": options.panel_size if options.effort == "panel" else None,
            "tokens_in": sum(c.tokens_in for c in spent),
            "tokens_out": sum(c.tokens_out for c in spent),
            "cost_usd": cost,
            "duration_s": round(duration_s, 2),
            "cache_hits": sum(1 for c in rc.calls if c.cached),
            "created_at": summary.created_at,
            "parent_run_id": summary.parent_run_id,
            "correction_id": rc.corrections[-1].id if summary.parent_run_id else None,
            "failed_nodes": sorted(set(rc.failed_nodes)),
        }
    )
    return report.model_copy(update={"meta": meta})


def _total_cost(calls: list[LLMCallRecord]) -> float | None:
    if any(c.cost_usd is None for c in calls):
        return None  # prices unknown: tokens are logged, cost is not guessed
    return sum(c.cost_usd for c in calls if c.cost_usd is not None)


async def _build_context(services: "Services", summary: RunSummary) -> RunContext:
    run_id = summary.id
    lineage = await services.runs.lineage(run_id)
    corrections = await services.corrections.get_many(
        [e.correction_id for e in lineage if e.correction_id]
    )
    options = summary.options
    knobs = services.llm.policy.knobs(options.effort)
    settings = services.settings
    rc = RunContext(
        run_id=run_id,
        services=services,
        summary=summary,
        llm=RunLLM(
            service=services.llm.service,
            registry=services.llm.registry,
            options=options,
            knobs=knobs,
            budget=RunBudget(settings.max_run_tokens, settings.max_run_cost_usd),
            panel=services.llm.panel,
            max_panel_size=settings.max_panel_size,
        ),
        knobs=knobs,
        corrections=corrections,
        parent_run_id=summary.parent_run_id,
        hold_s=hold_per_step(settings.demo_run_seconds),
    )
    if summary.parent_run_id:
        affected = affected_set(corrections[-1].node_id)
        deltas = await services.nodes.deltas(summary.parent_run_id)
        executions = await services.nodes.for_run(summary.parent_run_id)
        rc.parent_outputs = {e.node_id: e for e in executions}
        rc.reuse = {n: deltas[n] for n in runnable_ids() if n not in affected and n in deltas}
    return rc


async def execute_run(services: "Services", run_id: str) -> None:
    runs, bus = services.runs, services.bus
    summary = await runs.get(run_id)
    if summary is None:
        log.error("run %s vanished before it started", run_id)
        return
    started = time.monotonic()
    await runs.set_status(run_id, "running")
    try:
        rc = await _build_context(services, summary)
        bus.emit(
            run_id,
            "run.started",
            effort=summary.options.effort,
            model=rc.llm.model,
            parent_run_id=summary.parent_run_id,
            reused=sorted(rc.reuse),
        )
        state = {
            "program": summary.program,
            "options": summary.options,
            "corrections": rc.corrections,
        }
        final = await get_graph().ainvoke(
            state, config={"configurable": {"run_ctx": rc}, "recursion_limit": 60}
        )
        report = final.get("report")
        if report is None:
            raise RuntimeError("the graph finished without a report")
        report = _finalize(report, summary, rc, time.monotonic() - started)
        await runs.save_report(run_id, report)
        await runs.set_status(run_id, "completed", decision=report.verdict.decision)
        bus.emit(
            run_id,
            "run.completed",
            decision=report.verdict.decision,
            cost_usd=report.meta.cost_usd,
            tokens_in=report.meta.tokens_in,
            tokens_out=report.meta.tokens_out,
            duration_s=report.meta.duration_s,
        )
    except asyncio.CancelledError:
        await runs.set_status(run_id, "failed", error="cancelled")
        bus.emit(run_id, "run.failed", error="cancelled")
        raise
    except Exception as exc:
        log.exception("run %s failed", run_id)
        await runs.set_status(run_id, "failed", error=str(exc)[:1000])
        bus.emit(run_id, "run.failed", error=str(exc)[:1000])
    finally:
        await bus.flush()
        bus.forget(run_id)
