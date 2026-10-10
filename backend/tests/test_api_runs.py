import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.contracts import (
    ModelInfo,
    NodeExecution,
    ReportDiff,
    RunDetail,
    RunEvent,
    RunSummary,
    UnderwritingReport,
)
from app.main import create_app

BODY = {"program": {"indication": "Alzheimer's disease", "mechanism": "BACE1 inhibition"}}


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
        yield client


def start(client: TestClient, body: dict | None = None) -> str:
    response = client.post("/api/runs", json=body or BODY)
    assert response.status_code == 202, response.text
    return RunSummary.model_validate(response.json()).id


def wait(client: TestClient, run_id: str) -> RunDetail:
    deadline = time.time() + 15
    while time.time() < deadline:
        detail = RunDetail.model_validate(client.get(f"/api/runs/{run_id}").json())
        if detail.summary.status in ("completed", "failed"):
            return detail
        time.sleep(0.02)
    raise AssertionError("run did not finish")


def sse(client: TestClient, run_id: str, last_event_id: int | None = None) -> list[RunEvent]:
    headers = {"Last-Event-ID": str(last_event_id)} if last_event_id is not None else {}
    events: list[RunEvent] = []
    with client.stream("GET", f"/api/runs/{run_id}/events", headers=headers) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        sse_id = None
        for line in response.iter_lines():
            if line.startswith("id:"):
                sse_id = int(line.split(":", 1)[1])
            elif line.startswith("data:"):
                event = RunEvent.model_validate_json(line.split(":", 1)[1])
                assert event.seq == sse_id
                events.append(event)
    return events


def test_create_run_validates_input_with_field_paths(client: TestClient):
    response = client.post("/api/runs", json={"program": {"mechanism": "BACE1"}})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert any(d["path"] == "body.program.indication" for d in error["details"])


def test_panel_size_is_capped_by_settings(client: TestClient):
    body = {**BODY, "options": {"effort": "panel", "panel_size": 9}}
    response = client.post("/api/runs", json=body)
    assert response.status_code == 422 and "capped" in response.json()["error"]["message"]


def test_run_lifecycle_endpoints(client: TestClient):
    run_id = start(client)
    detail = wait(client, run_id)
    assert detail.summary.status == "completed" and detail.summary.decision == "conditional"
    assert detail.report is not None and len(detail.nodes) == 32
    assert all(n.log == [] and n.llm_calls == [] for n in detail.nodes)  # compact list

    assert [r.id for r in map(RunSummary.model_validate, client.get("/api/runs").json())] == [
        run_id
    ]
    report = UnderwritingReport.model_validate(client.get(f"/api/runs/{run_id}/report").json())
    assert report.run_id == run_id

    node = NodeExecution.model_validate(client.get(f"/api/runs/{run_id}/nodes/fetch_trials").json())
    assert node.status == "done" and node.log and node.source_ids
    assert client.get(f"/api/runs/{run_id}/nodes/nope").status_code == 404
    assert client.get("/api/runs/run_missing").json()["error"]["code"] == "run_not_found"


def test_sse_replays_full_history_after_the_run_and_resumes_from_last_event_id(
    client: TestClient,
):
    run_id = start(client)
    wait(client, run_id)

    full = sse(client, run_id)
    assert [e.seq for e in full] == list(range(1, len(full) + 1))
    assert full[0].type == "run.started" and full[-1].type == "run.completed"

    resumed = sse(client, run_id, last_event_id=40)
    assert [e.seq for e in resumed] == list(range(41, len(full) + 1))
    assert resumed[-1].type == "run.completed"
    assert sse(client, run_id, last_event_id=len(full)) == []


def test_sse_attached_while_running_sees_everything_once(client: TestClient, monkeypatch):
    monkeypatch.setenv("STUB_DELAY_SCALE", "0.05")
    from app.core.settings import get_settings

    get_settings.cache_clear()
    with TestClient(create_app()) as slow:
        run_id = start(slow)
        live = sse(slow, run_id)  # attaches mid-run, ends at run.completed
        assert [e.seq for e in live] == list(range(1, len(live) + 1))
        assert live[-1].type == "run.completed"
        assert [e.seq for e in sse(slow, run_id)] == [e.seq for e in live]


def test_correction_creates_child_run_and_diff(client: TestClient):
    parent = start(client)
    wait(client, parent)
    response = client.post(
        f"/api/runs/{parent}/nodes/verdict/corrections",
        json={"text": "the earlier trials were terminated"},
    )
    assert response.status_code == 202
    child = RunSummary.model_validate(response.json())
    assert child.parent_run_id == parent and child.id != parent
    done = wait(client, child.id)
    assert done.summary.decision == "do_not_invest"
    assert {n.node_id for n in done.nodes if n.status == "done"} == {"verdict", "report_assembler"}
    assert sum(n.status == "reused" for n in done.nodes) == 30

    diff = ReportDiff.model_validate(client.get(f"/api/runs/{parent}/diff/{child.id}").json())
    assert (diff.decision_before, diff.decision_after) == ("conditional", "do_not_invest")
    events = sse(client, child.id)
    assert sum(e.type == "node.reused" for e in events) == 30

    bad = client.post(f"/api/runs/{parent}/nodes/report_assembler/corrections", json={"text": "x"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "node_not_correctable"
    other = start(client)
    wait(client, other)
    assert client.get(f"/api/runs/{parent}/diff/{other}").status_code == 400


def test_evidence_drill_down_resolves_to_a_source(client: TestClient):
    run_id = start(client)
    report = UnderwritingReport.model_validate(wait(client, run_id).report)
    claim = next(c for c in report.claims.values() if c.evidence_ids and c.status == "accepted")
    detail = client.get(f"/api/evidence/{claim.evidence_ids[0]}").json()
    assert detail["evidence"]["id"] == claim.evidence_ids[0]
    assert detail["source"]["id"] == detail["evidence"]["source_id"]
    assert client.get("/api/evidence/ev_nope").status_code == 404


def test_trace_is_a_complete_download(client: TestClient):
    run_id = start(client)
    wait(client, run_id)
    response = client.get(f"/api/runs/{run_id}/trace")
    assert "attachment" in response.headers["content-disposition"]
    trace = json.loads(response.content)
    assert trace["run"]["id"] == run_id and trace["lineage"] == [run_id]
    assert trace["events"][-1]["type"] == "run.completed"
    assert len(trace["nodes"]) == 32 and trace["llm_calls"]


def test_models_are_listed_with_one_default(client: TestClient):
    models = [ModelInfo.model_validate(m) for m in client.get("/api/models").json()]
    assert [m.default for m in models] == [True] and models[0].available


def corrected(client: TestClient) -> tuple[str, str]:
    parent = start(client)
    wait(client, parent)
    response = client.post(
        f"/api/runs/{parent}/nodes/verdict/corrections",
        json={"text": "the earlier trials were terminated"},
    )
    child = RunSummary.model_validate(response.json()).id
    wait(client, child)
    return parent, child


def test_deleting_a_run_removes_it_with_its_versions_and_what_only_they_own(client: TestClient):
    from app.contracts import LLMCallRecord

    services = client.app.state.services
    parent, child = corrected(client)
    keep = start(client)
    wait(client, keep)
    for run_id in (parent, keep):
        assert client.post(f"/api/runs/{run_id}/summary").status_code == 200
    spend = LLMCallRecord(
        model="m", purpose="x", tokens_in=1, tokens_out=1, cost_usd=0.01, cached=False, latency_ms=1
    )
    asyncio.run(services.llm_repo.add_call(parent, "summary", spend))
    spent_before = len(asyncio.run(services.llm_repo.calls_for_run(parent)))
    assert spent_before > 0

    assert client.delete(f"/api/runs/{parent}").status_code == 204
    for run_id in (parent, child):
        assert client.get(f"/api/runs/{run_id}").status_code == 404
        assert client.get(f"/api/runs/{run_id}/messages").status_code == 404
        assert asyncio.run(services.chat.get_summary(run_id)) is None
        assert asyncio.run(services.nodes.for_run(run_id)) == []
    assert [r.id for r in asyncio.run(services.runs.recent())] == [keep]
    assert client.get(f"/api/runs/{keep}/report").status_code == 200
    assert asyncio.run(services.chat.get_summary(keep)) is not None
    # what was spent stays on the books
    assert len(asyncio.run(services.llm_repo.calls_for_run(parent))) == spent_before
    assert client.delete(f"/api/runs/{parent}").status_code == 404


def test_deleting_a_corrected_version_leaves_the_run_it_came_from(client: TestClient):
    parent, child = corrected(client)
    assert client.delete(f"/api/runs/{child}").status_code == 204
    assert client.get(f"/api/runs/{child}").status_code == 404
    assert client.get(f"/api/runs/{parent}/report").status_code == 200
    # a correction made on the run no longer has a version to show
    corrections = client.get(f"/api/runs/{parent}/trace").json()["corrections"]
    assert corrections == []


def test_a_run_that_is_still_working_cannot_be_deleted(client: TestClient):
    services = client.app.state.services
    parent, child = corrected(client)
    asyncio.run(services.runs.set_status(child, "running"))
    refused = client.delete(f"/api/runs/{parent}")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "run_active"
    assert client.get(f"/api/runs/{parent}").status_code == 200
    asyncio.run(services.runs.set_status(child, "failed"))
    assert client.delete(f"/api/runs/{parent}").status_code == 204
