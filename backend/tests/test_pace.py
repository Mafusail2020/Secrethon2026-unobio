import time

import pytest

from app.contracts import CorrectionRequest, ProgramInput, RunOptions
from app.graph.lifecycle import create_correction_run, create_run
from app.graph.pace import hold_per_step, longest_chain
from tests.conftest import run_to_end

PROGRAM = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")


def test_the_pace_is_spread_over_the_longest_chain_of_steps():
    # input, planner, a fetch, normalizer, indexer, four lane steps, analysts, ledger, valuation,
    # verdict, report
    assert longest_chain() == 14
    assert hold_per_step(28.0) == pytest.approx(2.0)
    assert hold_per_step(0) == 0 and hold_per_step(-3) == 0


async def _timed(services):
    clock = time.monotonic()
    summary = await create_run(services, PROGRAM, RunOptions())
    await run_to_end(services, summary.id)
    return summary.id, time.monotonic() - clock


async def test_a_run_of_fast_steps_is_stretched_to_about_the_chosen_time_and_says_so(services):
    services.settings.demo_run_seconds = 2.8
    run_id, took = await _timed(services)
    assert 2.6 <= took < 6.0
    events = await services.events.after(run_id, 0)
    # each step is shown as running during its hold, but its own duration is what it really took
    done = [e for e in events if e.type == "node.completed"]
    # counted as work, 32 holds of 0.2 s would add up to 6.4 s; the steps' real time is far less
    assert len(done) == 32 and sum(e.data["duration_ms"] for e in done) < 4000
    holds = [
        line.message
        for node in await services.nodes.for_run(run_id)
        for line in node.log
        if "demo pace" in line.message
    ]
    assert len(holds) == 32


async def test_it_is_off_unless_asked_for(services):
    run_id, took = await _timed(services)
    assert took < 2.0
    logs = [line.message for node in await services.nodes.for_run(run_id) for line in node.log]
    assert not any("demo pace" in m for m in logs)


async def test_steps_a_correction_reuses_are_not_held(services):
    parent, _ = await _timed(services)
    services.settings.demo_run_seconds = 2.8
    clock = time.monotonic()
    child = await create_correction_run(
        services, parent, "verdict", CorrectionRequest(text="the earlier trials were terminated")
    )
    await run_to_end(services, child.id)
    # only the verdict and the report assembler run again: two holds of 0.2 s, not fourteen
    assert time.monotonic() - clock < 1.6
