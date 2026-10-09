import time
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.chat.answer import REFUSAL, ChatAnswer, build_prompt, gate_answer
from app.chat.documents import MAX_PASSAGES, Passage, document_ids, passages_for
from app.contracts import ChatMessage, UnderwritingReport
from app.main import create_app
from app.sources.documents import document_records, read_document
from tests.test_document_ingest import PAGES, make_pdf
from tests.test_fixtures import FIXTURES

REPORT = UnderwritingReport.model_validate_json(
    (FIXTURES / "report_bace1_alzheimers.json").read_text()
)
PAGES3 = [*PAGES, "The sponsor's cafeteria budget was reviewed in March."]


def _passage(eid: str = "ev_0123456789abcdef") -> Passage:
    evidence = next(iter(REPORT.evidence.values())).model_copy(
        update={"id": eid, "excerpt": "Abeta42 fell 62 percent at 10 mg/kg.", "locator": "p. 3"}
    )
    return Passage(evidence, "study.pdf")


def test_the_gate_lets_an_answer_rest_on_a_passage_alone_and_drops_invented_ids():
    passage = _passage()
    answer = ChatAnswer(
        supported=True,
        answer="Abeta fell 62%.",
        cited_claim_ids=["ghost"],
        cited_evidence_ids=[passage.evidence.id, "ev_ghost", passage.evidence.id],
    )
    message = gate_answer(answer, {"real"}, "r", {passage.evidence.id})
    assert message.cited_evidence_ids == [passage.evidence.id] and message.cited_claim_ids == []
    assert message.content == "Abeta fell 62%."


def test_a_passage_that_was_not_shown_to_the_model_does_not_count():
    answer = ChatAnswer(
        supported=True, answer="made up", cited_evidence_ids=["ev_0123456789abcdef"]
    )
    assert gate_answer(answer, {"real"}, "r", set()).content == REFUSAL


def test_the_prompt_carries_the_passages_with_their_ids_and_places_inside_the_files():
    passage = _passage()
    prompt = build_prompt("ctx", [], "what dose?", [passage])
    assert f'[{passage.evidence.id}] study.pdf, p. 3: "Abeta42 fell 62 percent' in prompt
    assert prompt.index("<documents>") < prompt.index("<question>")
    assert "<documents>" not in build_prompt("ctx", [], "what dose?")


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
        yield client


def _report_reading(services, name: str, pages: list[str]):
    data = make_pdf(pages)
    info = services.documents.save(name, data)
    source, items = document_records(info, read_document(data, "pdf"), [])
    return REPORT.model_copy(update={"sources": {source.id: source}}), items


async def test_passages_are_the_chunks_that_match_the_question_best(services):
    report, items = _report_reading(services, "study.pdf", PAGES3)
    assert document_ids(report) and len(items) == 3
    await services.store.vectors.add(items)
    top = await passages_for(services, report, "how much did Abeta42 fall in mice?")
    assert top[0].evidence.excerpt == PAGES3[0] and top[0].name == "study.pdf"
    assert top[0].label == "study.pdf, p. 1"
    assert all(p.evidence.id in {e.id for e in items} for p in top)


async def test_a_question_that_matches_nothing_still_gets_the_start_of_the_files(services):
    report, items = _report_reading(services, "plain.pdf", PAGES3)
    await services.store.vectors.add(items)
    got = await passages_for(services, report, "zzzz qqqq")
    assert [p.evidence.id for p in got] == [e.id for e in items][:MAX_PASSAGES]


async def test_a_report_that_read_no_files_has_no_passages(services):
    assert await passages_for(services, REPORT, "anything") == []


async def test_a_file_that_cannot_be_read_gives_no_passages_and_no_error(services):
    report, _ = _report_reading(services, "gone.pdf", PAGES)
    for doc in list(services.documents.root.glob("*.bin")):
        doc.write_bytes(b"%PDF-1.4 not a pdf")
    from app.chat import documents

    documents._chunks.clear()
    assert await passages_for(services, report, "anything") == []


def _finish(client: TestClient, run_id: str) -> None:
    for _ in range(400):
        if client.get(f"/api/runs/{run_id}").json()["summary"]["status"] == "completed":
            return
        time.sleep(0.03)
    raise AssertionError("run did not finish")


def test_a_follow_up_can_cite_the_user_s_file_and_the_citation_is_remembered_and_resolves(client):
    upload = client.post(
        "/api/documents", content=make_pdf(PAGES), headers={"X-File-Name": quote("study.pdf")}
    ).json()
    body = {
        "program": {
            "indication": "Alzheimer's disease",
            "mechanism": "BACE1 inhibition",
            "document_ids": [upload["id"]],
        }
    }
    run = client.post("/api/runs", json=body).json()["id"]
    _finish(client, run)
    reply = client.post(
        f"/api/runs/{run}/messages", json={"role": "user", "content": "How much did Abeta42 fall?"}
    ).json()
    assert reply["cited_evidence_ids"], reply
    detail = client.get(f"/api/evidence/{reply['cited_evidence_ids'][0]}").json()
    assert detail["source"]["identifiers"]["document"] == upload["id"]
    assert detail["evidence"]["locator"].startswith("p. ")
    history = client.get(f"/api/runs/{run}/messages").json()
    assert history[-1]["cited_evidence_ids"] == reply["cited_evidence_ids"]
    assert history[-1]["cited_claim_ids"] == reply["cited_claim_ids"]
    assert all(i.startswith("clm_") for i in history[-1]["cited_claim_ids"])


def test_chat_messages_without_files_are_unchanged(client):
    run = client.post(
        "/api/runs", json={"program": {"indication": "Alzheimer's disease", "mechanism": "BACE1"}}
    ).json()["id"]
    _finish(client, run)
    reply = client.post(
        f"/api/runs/{run}/messages", json={"role": "user", "content": "Why?"}
    ).json()
    assert reply["cited_evidence_ids"] == [] and reply["cited_claim_ids"]


def test_the_user_message_keeps_no_citations():
    assert ChatMessage(role="user", content="x").cited_evidence_ids == []
