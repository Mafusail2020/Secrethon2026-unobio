import pytest

from app.contracts import CorrectionRequest, ProgramInput, RunOptions
from app.core.errors import ApiError
from app.graph.lifecycle import create_correction_run, create_run, diff_runs
from app.graph.replay import affected_set
from app.graph.topology import CONTAINERS, runnable_ids
from tests.conftest import run_to_end

PROGRAM = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")
DOWNSTREAM_OF_FETCH = {
    "evidence_normalizer", "knowledge_indexer", *CONTAINERS["bull_case"], *CONTAINERS["bear_case"],
    "section_analysts", "evidence_ledger", "valuation", "verdict", "report_assembler",
}  # fmt: skip


def test_affected_set_is_node_plus_descendants():
    assert affected_set("verdict") == {"verdict", "report_assembler"}
    assert affected_set("fetch_trials") == {"fetch_trials"} | DOWNSTREAM_OF_FETCH


def test_affected_set_is_subgraph_aware():
    bull_writer = affected_set("bull_claim_writer")
    assert {"bull_claim_writer", "bull_claim_gate", "section_analysts"} <= bull_writer
    assert not {"bull_query_planner", "bull_retriever", "bear_claim_writer"} & bull_writer
    container = affected_set("bull_case")
    assert set(CONTAINERS["bull_case"]) <= container
    assert not set(CONTAINERS["bear_case"]) & container
    assert "bull_case" not in container  # containers never execute


async def _parent(services) -> str:
    summary = await create_run(services, PROGRAM, RunOptions())
    await run_to_end(services, summary.id)
    return summary.id


async def _correct(services, run_id: str, node_id: str, text: str, **kw) -> str:
    child = await create_correction_run(
        services, run_id, node_id, CorrectionRequest(text=text, **kw)
    )
    await run_to_end(services, child.id)
    return child.id


async def _statuses(services, run_id: str) -> dict[str, str]:
    return {e.node_id: e.status for e in await services.nodes.for_run(run_id)}


async def test_verdict_correction_recomputes_only_descendants_and_flips_decision(services):
    parent = await _parent(services)
    child = await _correct(services, parent, "verdict", "the earlier trials were terminated")

    statuses = await _statuses(services, child)
    assert {n for n, s in statuses.items() if s == "done"} == {"verdict", "report_assembler"}
    assert {n for n, s in statuses.items() if s == "reused"} == set(runnable_ids()) - {
        "verdict", "report_assembler",
    }  # fmt: skip

    events = await services.events.after(child, 0)
    assert {e.node_id for e in events if e.type == "node.reused"} == set(runnable_ids()) - {
        "verdict", "report_assembler",
    }  # fmt: skip
    started = [e.node_id for e in events if e.type == "node.started"]
    assert sorted(started) == ["report_assembler", "verdict"]

    report = await services.runs.get_report(child)
    assert report.verdict.decision == "do_not_invest"
    assert report.meta.parent_run_id == parent and report.meta.correction_id
    assert report.meta.tokens_in == 0 and not any(
        c for e in await services.nodes.for_run(child) if e.status == "reused" for c in e.llm_calls
    )

    diff = await diff_runs(services, parent, child)
    assert (diff.decision_before, diff.decision_after) == ("conditional", "do_not_invest")
    assert sorted(diff.recomputed_nodes) == ["report_assembler", "verdict"]
    assert diff.added_claim_ids == [] and diff.removed_claim_ids == []

    execution = await services.nodes.get(child, "verdict")
    assert len(execution.correction_ids) == 1


async def test_excluding_evidence_upstream_changes_claims_downstream(services):
    parent = await _parent(services)
    parent_report = await services.runs.get_report(parent)
    trial_evidence = [
        e.id for e in parent_report.evidence.values() if e.data and e.data.get("nct_id")
    ]
    assert len(trial_evidence) == 2

    child = await _correct(
        services, parent, "fetch_trials", "ignore these trials", exclude_evidence_ids=trial_evidence
    )
    statuses = await _statuses(services, child)
    recomputed = {n for n, s in statuses.items() if s == "done"}
    assert recomputed == {"fetch_trials"} | DOWNSTREAM_OF_FETCH
    reused = {n for n, s in statuses.items() if s == "reused"}
    assert {"input_resolver", "fetch_literature", "fetch_regulatory", "twin_stats"} <= reused

    report = await services.runs.get_report(child)
    assert not set(trial_evidence) & set(report.evidence)
    terminated = [c for c in report.claims.values() if "TERMINATED" in c.text]
    assert terminated and all(c.status == "rejected" for c in terminated)
    assert report.sections["clinical_plan"].status != "ok"
    assert report.pos.base > parent_report.pos.base  # the 'terminated twins' step dropped out

    diff = await diff_runs(services, parent, child)
    assert "clinical_plan" in diff.changed_sections
    assert diff.pos_after.base > diff.pos_before.base


async def test_corrections_accumulate_along_the_lineage(services):
    parent = await _parent(services)
    child = await _correct(services, parent, "verdict", "a trial was terminated")
    grandchild = await _correct(services, child, "valuation", "capital is higher than assumed")

    statuses = await _statuses(services, grandchild)
    assert {n for n, s in statuses.items() if s == "done"} == {
        "valuation", "verdict", "report_assembler",
    }  # fmt: skip
    report = await services.runs.get_report(grandchild)
    assert report.verdict.decision == "do_not_invest"  # the first correction still applies
    assert (await services.nodes.get(grandchild, "valuation")).correction_ids != []

    diff = await diff_runs(services, parent, grandchild)
    assert diff.decision_after == "do_not_invest"
    with pytest.raises(ApiError) as err:
        other_root = await _parent(services)
        await diff_runs(services, parent, other_root)
    assert err.value.code == "different_lineage"


async def test_subgraph_correction_reuses_upstream_inner_nodes(services):
    parent = await _parent(services)
    child = await _correct(services, parent, "bull_claim_writer", "be more careful")
    statuses = await _statuses(services, child)
    assert statuses["bull_query_planner"] == statuses["bull_retriever"] == "reused"
    assert statuses["bull_claim_writer"] == statuses["bull_claim_gate"] == "done"
    assert statuses["bear_claim_gate"] == "reused"


async def test_correction_validation(services):
    parent = await _parent(services)
    body = CorrectionRequest(text="x")
    with pytest.raises(ApiError) as err:
        await create_correction_run(services, parent, "report_assembler", body)
    assert err.value.status_code == 422 and err.value.code == "node_not_correctable"
    with pytest.raises(ApiError) as err:
        await create_correction_run(services, parent, "nope", body)
    assert err.value.status_code == 404
    with pytest.raises(ApiError) as err:
        await create_correction_run(services, "run_missing", "verdict", body)
    assert err.value.status_code == 404
    running = await create_run(services, PROGRAM, RunOptions())
    with pytest.raises(ApiError) as err:  # still queued or running
        await create_correction_run(services, running.id, "verdict", body)
    assert err.value.status_code == 409
    await run_to_end(services, running.id)
