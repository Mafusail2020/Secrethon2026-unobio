import pytest

from app.contracts import ProgramInput, RunOptions
from app.graph.lifecycle import create_run
from app.graph.registry import get_registry
from app.graph.topology import EDGES, runnable_ids
from tests.conftest import run_to_end

PROGRAM = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")


async def _run(services, options: RunOptions | None = None):
    summary = await create_run(services, PROGRAM, options or RunOptions())
    await run_to_end(services, summary.id)
    return summary.id


async def test_run_completes_with_a_valid_synthetic_report(services):
    run_id = await _run(services)
    summary = await services.runs.get(run_id)
    assert summary.status == "completed" and summary.decision == "conditional"
    report = await services.runs.get_report(run_id)
    assert report.run_id == run_id and report.meta.synthetic is True
    assert report.meta.cost_usd == 0.0 and report.meta.tokens_in == 0
    assert len(report.sections) == 8 and report.meta.failed_nodes == []
    # every accepted claim cites evidence that is in the report, and every evidence has its source
    for claim in report.claims.values():
        if claim.status != "rejected":
            assert set(claim.evidence_ids) <= set(report.evidence)
    assert all(e.source_id in report.sources for e in report.evidence.values())
    # the gate rejects the claim citing the user's note (none was given); the fixture ships one more
    rejected = {
        c.text: c.rejection_reason for c in report.claims.values() if c.status == "rejected"
    }
    assert len(rejected) == 2
    assert "cited evidence is not in this run" in rejected.values()


async def test_event_order_and_completeness(services):
    run_id = await _run(services)
    events = await services.events.after(run_id, 0)
    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    assert events[0].type == "run.started" and events[-1].type == "run.completed"
    assert sum(e.type == "run.completed" for e in events) == 1

    first: dict[tuple[str, str], int] = {}
    for e in events:
        if e.node_id:
            first.setdefault((e.node_id, e.type), e.seq)
    runnable = runnable_ids()
    for node_id in runnable:
        assert (node_id, "node.started") in first and (node_id, "node.completed") in first
        assert first[(node_id, "node.started")] < first[(node_id, "node.completed")]
    # a node starts only after all of its upstream nodes completed
    for source, target in EDGES:
        assert first[(source, "node.completed")] < first[(target, "node.started")], (source, target)
    # llm.call events come from analysis nodes while they run
    kinds = {n: e.spec.kind for n, e in get_registry().items()}
    for e in events:
        if e.type == "llm.call":
            assert kinds[e.node_id] == "analysis" and e.data["cost_usd"] == 0.0


async def test_node_executions_are_recorded_with_logs_and_deltas(services):
    run_id = await _run(services)
    executions = {e.node_id: e for e in await services.nodes.for_run(run_id)}
    assert set(executions) == set(runnable_ids())
    assert all(e.status == "done" for e in executions.values())
    trials = executions["fetch_trials"]
    assert len(trials.log) >= 2 and trials.source_ids
    assert executions["section_analysts"].llm_calls  # mock calls are recorded too
    deltas = await services.nodes.deltas(run_id)
    assert "verdict" in deltas["verdict"] and "report" in deltas["report_assembler"]


async def test_panel_effort_attaches_panel_results_to_sections(services):
    run_id = await _run(services, RunOptions(effort="panel", panel_size=3))
    report = await services.runs.get_report(run_id)
    assert report.meta.panel_size == 3 and report.meta.effort == "panel"
    panels = [s.panel for s in report.sections.values()]
    assert all(p is not None and len(p.candidates) == 2 for p in panels)
    calls = (await services.nodes.get(run_id, "section_analysts")).llm_calls
    assert calls and all(c.purpose.endswith(".panel") for c in calls)


@pytest.fixture
def break_node():
    """Swap a node's run function for one that raises; always restored."""
    saved: list[tuple[object, object]] = []

    def apply(node_id: str, message: str) -> None:
        async def boom(state, ctx):
            raise RuntimeError(message)

        entry = get_registry()[node_id]
        saved.append((entry, entry.run))
        object.__setattr__(entry, "run", boom)

    yield apply
    for entry, original in saved:
        object.__setattr__(entry, "run", original)


async def test_failing_noncritical_node_is_fail_soft(services, break_node):
    break_node("fetch_literature", "europe pmc is down")
    run_id = await _run(services)
    execution = await services.nodes.get(run_id, "fetch_literature")
    assert execution.status == "failed" and "europe pmc is down" in execution.error
    report = await services.runs.get_report(run_id)
    assert report.meta.failed_nodes == ["fetch_literature"]
    events = await services.events.after(run_id, 0)
    assert any(e.type == "node.failed" and e.node_id == "fetch_literature" for e in events)
    assert events[-1].type == "run.completed"
    # evidence only that node supplied is gone; claims that cited it are rejected, not left dangling
    assert all(e.source_id in report.sources for e in report.evidence.values())
    for claim in report.claims.values():
        if claim.status != "rejected":
            assert set(claim.evidence_ids) <= set(report.evidence)


async def test_failing_critical_node_fails_the_run(services, break_node):
    break_node("input_resolver", "cannot resolve")
    run_id = await _run(services)
    summary = await services.runs.get(run_id)
    assert summary.status == "failed" and "cannot resolve" in summary.error
    events = await services.events.after(run_id, 0)
    assert events[-1].type == "run.failed"
    assert not any(e.type == "node.started" and e.node_id == "question_planner" for e in events)


async def test_interrupted_runs_get_a_terminal_event_on_startup(services):
    from app.contracts import RunSummary, utcnow
    from app.graph.lifecycle import recover_interrupted

    stuck = RunSummary(
        id="run_stuck", status="running", program=PROGRAM, options=RunOptions(), created_at=utcnow()
    )
    await services.runs.create(stuck)
    services.bus.emit("run_stuck", "run.started")
    await services.bus.flush()
    services.bus.forget("run_stuck")
    assert await recover_interrupted(services) == ["run_stuck"]
    assert (await services.runs.get("run_stuck")).status == "failed"
    events = await services.events.after("run_stuck", 0)
    assert [e.type for e in events] == ["run.started", "run.failed"]


async def test_ledger_steps_carry_pos_after_and_the_last_one_is_the_posterior(services):
    report = await services.runs.get_report(await _run(services))
    ledger = report.ledger
    assert ledger and all(s.pos_after for s in ledger.steps)
    assert ledger.steps[-1].pos_after == ledger.posterior == report.pos


async def test_twin_sources_are_in_the_report_even_when_their_evidence_is_excluded(services):
    from app.contracts import CorrectionRequest
    from app.graph.lifecycle import create_correction_run

    parent = await _run(services)
    parent_report = await services.runs.get_report(parent)
    trial_evidence = [
        e.id for e in parent_report.evidence.values() if e.data and e.data.get("nct_id")
    ]
    child = await create_correction_run(
        services,
        parent,
        "fetch_trials",
        CorrectionRequest(text="ignore", exclude_evidence_ids=trial_evidence),
    )
    await run_to_end(services, child.id)
    report = await services.runs.get_report(child.id)
    assert not set(trial_evidence) & set(report.evidence)
    twin_sources = {i for t in report.twin_stats.twins for i in t.source_ids}
    assert twin_sources and twin_sources <= set(report.sources)
