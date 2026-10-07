from uuid import uuid4

from app.contracts import (
    Correction,
    CorrectionRequest,
    ProgramInput,
    ReportDiff,
    RunOptions,
    RunSummary,
    utcnow,
)
from app.core.errors import ApiError
from app.core.services import Services
from app.graph.diff import diff_reports
from app.graph.registry import get_registry


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


async def create_run(
    services: Services,
    program: ProgramInput,
    options: RunOptions,
    *,
    parent_run_id: str | None = None,
    correction_id: str | None = None,
) -> RunSummary:
    summary = RunSummary(
        id=new_id("run"),
        status="queued",
        program=program,
        options=options,
        created_at=utcnow(),
        parent_run_id=parent_run_id,
    )
    await services.runs.create(summary, correction_id=correction_id)
    services.manager.submit(summary.id)
    return summary


async def create_correction_run(
    services: Services, parent_run_id: str, node_id: str, request: CorrectionRequest
) -> RunSummary:
    parent = await services.runs.get(parent_run_id)
    if parent is None:
        raise ApiError(404, "run_not_found", f"no run {parent_run_id}")
    if parent.status != "completed":
        raise ApiError(409, "run_not_completed", "corrections need a completed parent run")
    entry = get_registry().get(node_id)
    if entry is None:
        raise ApiError(404, "node_not_found", f"no node {node_id}")
    if not entry.spec.correctable:
        raise ApiError(422, "node_not_correctable", f"{node_id} cannot be corrected")

    correction = Correction(
        id=new_id("cor"),
        run_id=parent_run_id,
        node_id=node_id,
        text=request.text,
        exclude_evidence_ids=request.exclude_evidence_ids,
        add_links=request.add_links,
        add_notes=request.add_notes,
        created_at=utcnow(),
    )
    await services.corrections.create(correction)
    options = parent.options
    if request.add_links or request.add_notes:
        options = options.model_copy(update={"force_refresh": True})
    return await create_run(
        services, parent.program, options, parent_run_id=parent_run_id, correction_id=correction.id
    )


async def recover_interrupted(services: Services) -> list[str]:
    """Runs that were mid-flight when the process died get a terminal event so streams end."""
    ids = await services.runs.mark_interrupted()
    for run_id in ids:
        await services.bus.seed(run_id)
        services.bus.emit(run_id, "run.failed", error="server restarted before the run finished")
    await services.bus.flush()
    for run_id in ids:
        services.bus.forget(run_id)
    return ids


async def diff_runs(services: Services, from_run: str, to_run: str) -> ReportDiff:
    reports = {}
    roots = {}
    for run_id in (from_run, to_run):
        if await services.runs.get(run_id) is None:
            raise ApiError(404, "run_not_found", f"no run {run_id}")
        report = await services.runs.get_report(run_id)
        if report is None:
            raise ApiError(409, "run_not_completed", f"run {run_id} has no report yet")
        reports[run_id] = report
        roots[run_id] = (await services.runs.lineage(run_id))[0].run_id
    if roots[from_run] != roots[to_run]:
        raise ApiError(400, "different_lineage", "runs are not part of the same correction lineage")
    executed = [e.node_id for e in await services.nodes.for_run(to_run) if e.status != "reused"]
    return diff_reports(reports[from_run], reports[to_run], from_run, to_run, executed)
