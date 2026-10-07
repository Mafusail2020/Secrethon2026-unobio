import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_services
from app.contracts import (
    ChatMessage,
    CorrectionRequest,
    CreateRunRequest,
    ErrorResponse,
    NodeExecution,
    ReportDiff,
    RunDetail,
    RunEvent,
    RunSummary,
    UnderwritingReport,
)
from app.core.errors import ApiError
from app.core.events import TERMINAL_EVENTS
from app.core.services import Services
from app.graph.lifecycle import create_correction_run, create_run, diff_runs

router = APIRouter()
Svc = Annotated[Services, Depends(get_services)]


async def _require_run(services: Services, run_id: str) -> RunSummary:
    summary = await services.runs.get(run_id)
    if summary is None:
        raise ApiError(404, "run_not_found", f"no run {run_id}")
    return summary


@router.post("/runs", status_code=202, response_model=RunSummary)
async def post_run(body: CreateRunRequest, services: Svc) -> RunSummary:
    options, cap = body.options, services.settings.max_panel_size
    if options.panel_size > cap or len(options.panel_models or []) > cap:
        raise ApiError(422, "validation_error", f"panel size is capped at {cap}")
    return await create_run(services, body.program, options)


@router.get("/runs", response_model=list[RunSummary])
async def list_runs(services: Svc, limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return await services.runs.recent(limit)


@router.get("/runs/{run_id}", response_model=RunDetail)
async def get_run(run_id: str, services: Svc) -> RunDetail:
    summary = await _require_run(services, run_id)
    nodes = [
        n.model_copy(update={"log": [], "llm_calls": []})  # full detail: /runs/{id}/nodes/{node}
        for n in await services.nodes.for_run(run_id)
    ]
    return RunDetail(summary=summary, nodes=nodes, report=await services.runs.get_report(run_id))


@router.get(
    "/runs/{run_id}/events",
    responses={200: {"content": {"text/event-stream": {"schema": RunEvent.model_json_schema()}}}},
)
async def run_events(
    run_id: str,
    services: Svc,
    last_event_id: Annotated[str | None, Header()] = None,
) -> EventSourceResponse:
    await _require_run(services, run_id)
    try:
        last = int(last_event_id) if last_event_id else 0
    except ValueError:
        last = 0
    bus = services.bus

    async def stream() -> AsyncIterator[dict[str, Any]]:
        nonlocal last
        sub = bus.subscribe(run_id)  # before reading history, so nothing falls in the gap
        try:
            for event in await bus.history(run_id, last, sub):
                yield {"id": str(event.seq), "data": event.model_dump_json()}
                last = event.seq
                if event.type in TERMINAL_EVENTS:
                    return
            # a client resuming past the end of a finished run has nothing left to wait for
            tail = await services.events.last_event(run_id)
            if tail is not None and tail.type in TERMINAL_EVENTS and tail.seq <= last:
                return
            while True:
                event = await sub.queue.get()
                if event.seq <= last:
                    continue
                yield {"id": str(event.seq), "data": event.model_dump_json()}
                last = event.seq
                if event.type in TERMINAL_EVENTS:
                    return
        finally:
            bus.unsubscribe(run_id, sub)

    return EventSourceResponse(stream(), ping=15)


@router.get("/runs/{run_id}/report", response_model=UnderwritingReport)
async def get_report(run_id: str, services: Svc) -> UnderwritingReport:
    await _require_run(services, run_id)
    report = await services.runs.get_report(run_id)
    if report is None:
        raise ApiError(409, "report_not_ready", f"run {run_id} has no report")
    return report


@router.get("/runs/{run_id}/nodes/{node_id}", response_model=NodeExecution)
async def get_node(run_id: str, node_id: str, services: Svc) -> NodeExecution:
    await _require_run(services, run_id)
    execution = await services.nodes.get(run_id, node_id)
    if execution is None:
        raise ApiError(404, "node_not_found", f"node {node_id} has not run in {run_id}")
    return execution


@router.post(
    "/runs/{run_id}/nodes/{node_id}/corrections",
    status_code=202,
    response_model=RunSummary,
    responses={409: {"model": ErrorResponse}},
)
async def post_correction(
    run_id: str, node_id: str, body: CorrectionRequest, services: Svc
) -> RunSummary:
    return await create_correction_run(services, run_id, node_id, body)


@router.get("/runs/{run_id}/diff/{other_id}", response_model=ReportDiff)
async def get_diff(run_id: str, other_id: str, services: Svc) -> ReportDiff:
    """Changes going from run_id to other_id."""
    return await diff_runs(services, run_id, other_id)


@router.get("/runs/{run_id}/trace", responses={200: {"content": {"application/json": {}}}})
async def get_trace(run_id: str, services: Svc) -> JSONResponse:
    summary = await _require_run(services, run_id)
    lineage = await services.runs.lineage(run_id)
    corrections = await services.corrections.get_many(
        [e.correction_id for e in lineage if e.correction_id]
    )
    calls = await services.llm_repo.calls_for_run(run_id)
    trace = {
        "run": summary.model_dump(mode="json"),
        "lineage": [e.run_id for e in lineage],
        "corrections": [c.model_dump(mode="json") for c in corrections],
        "events": [e.model_dump(mode="json") for e in await services.events.after(run_id, 0)],
        "nodes": [n.model_dump(mode="json") for n in await services.nodes.for_run(run_id)],
        "llm_calls": [
            {
                "node_id": c.node_id,
                "model": c.model,
                "purpose": c.purpose,
                "tokens_in": c.tokens_in,
                "tokens_out": c.tokens_out,
                "cost_usd": c.cost_usd,
                "cached": c.cached,
                "latency_ms": c.latency_ms,
                "ts": c.ts.isoformat(),
            }
            for c in calls
        ],
    }
    return JSONResponse(
        json.loads(json.dumps(trace)),
        headers={"Content-Disposition": f'attachment; filename="trace_{run_id}.json"'},
    )


@router.post(
    "/runs/{run_id}/messages",
    status_code=501,
    response_model=ChatMessage,
    responses={501: {"model": ErrorResponse}},
)
async def post_message(run_id: str, body: ChatMessage, services: Svc) -> ChatMessage:
    await _require_run(services, run_id)
    raise ApiError(501, "not_implemented", "chat follow-ups arrive in Stage 3U")
