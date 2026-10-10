from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.contracts import DocumentInfo
from app.core.documents import MAX_BYTES, DocumentError, DocumentStore
from app.main import create_app

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"
BODY = {"program": {"indication": "Alzheimer's disease", "mechanism": "BACE1 inhibition"}}


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
        yield client


def upload(client: TestClient, name: str, data: bytes):
    return client.post("/api/documents", content=data, headers={"X-File-Name": quote(name)})


def test_a_pdf_is_kept_under_an_id_made_from_its_bytes(client):
    response = upload(client, "BACE1 preclinical.pdf", PDF)
    assert response.status_code == 201, response.text
    info = DocumentInfo.model_validate(response.json())
    assert (info.name, info.kind, info.size_bytes) == ("BACE1 preclinical.pdf", "pdf", len(PDF))
    again = DocumentInfo.model_validate(upload(client, "copy.pdf", PDF).json())
    assert again.id == info.id


def test_text_and_markdown_are_accepted_and_other_types_are_not(client):
    assert upload(client, "notes.txt", "Δ Aβ reduced 60%".encode()).json()["kind"] == "text"
    assert upload(client, "notes.md", b"# heading").json()["kind"] == "text"
    response = upload(client, "deck.pptx", b"PK\x03\x04")
    assert (
        response.status_code == 415 and response.json()["error"]["code"] == "unsupported_document"
    )


def test_a_file_that_is_not_what_its_name_says_is_refused(client):
    assert upload(client, "fake.pdf", b"<html>not a pdf</html>").status_code == 422
    assert upload(client, "bad.txt", b"\xff\xfe\x00broken").status_code == 422
    assert upload(client, "empty.txt", b"").status_code == 422


def test_a_file_over_the_limit_is_refused_before_it_is_kept(client):
    response = upload(client, "big.txt", b"a" * (MAX_BYTES + 1))
    assert response.status_code == 413 and response.json()["error"]["code"] == "document_too_large"


def test_the_name_is_cleaned_and_never_used_as_a_path(client):
    info = DocumentInfo.model_validate(upload(client, "../../etc/passwd.txt", b"x").json())
    assert info.name == "passwd.txt"


def test_a_run_can_name_uploaded_documents_but_not_made_up_ones(client):
    doc = upload(client, "notes.txt", b"mouse data").json()["id"]
    ok = client.post("/api/runs", json={"program": {**BODY["program"], "document_ids": [doc]}})
    assert ok.status_code == 202
    bad = client.post(
        "/api/runs", json={"program": {**BODY["program"], "document_ids": ["doc_0123456789abcdef"]}}
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unknown_document"
    malformed = client.post(
        "/api/runs", json={"program": {**BODY["program"], "document_ids": ["x"]}}
    )
    assert malformed.status_code == 422
    too_many = [f"doc_{i:016x}" for i in range(6)]
    assert (
        client.post(
            "/api/runs", json={"program": {**BODY["program"], "document_ids": too_many}}
        ).status_code
        == 422
    )


def test_a_stored_document_can_be_read_back_by_a_node(tmp_path):
    store = DocumentStore(tmp_path / "docs")
    info = store.save("a.pdf", PDF)
    stored = store.get(info.id)
    assert stored is not None and stored.read() == PDF and stored.info == info
    assert store.get("doc_0000000000000000") is None
    with pytest.raises(DocumentError):
        store.save("a.exe", b"MZ")


def _finished_run(client: TestClient, body: dict) -> str:
    from tests.test_api_runs import start, wait

    return wait(client, start(client, body)).summary.id


def test_a_document_can_be_looked_up_and_opened(client):
    info = upload(client, "Study (v2).txt", "Aβ −62 %".encode()).json()
    assert client.get(f"/api/documents/{info['id']}").json() == info
    opened = client.get(f"/api/documents/{info['id']}/file")
    assert opened.content == "Aβ −62 %".encode()
    assert opened.headers["content-type"].startswith("text/plain")
    assert opened.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in opened.headers["content-security-policy"]
    pdf = upload(client, "a.pdf", PDF).json()
    assert (
        client.get(f"/api/documents/{pdf['id']}/file").headers["content-type"] == "application/pdf"
    )
    assert client.get("/api/documents/doc_0123456789abcdef").status_code == 404
    assert client.get("/api/documents/doc_0123456789abcdef/file").status_code == 404


def test_a_correction_can_change_which_documents_a_run_reads(client):
    a = upload(client, "a.txt", b"first").json()["id"]
    b = upload(client, "b.txt", b"second").json()["id"]
    parent = _finished_run(client, {"program": {**BODY["program"], "document_ids": [a, b]}})
    url = f"/api/runs/{parent}/nodes/ingest_user_input/corrections"
    child = client.post(url, json={"text": "Only a.txt", "document_ids": [a]})
    assert child.status_code == 202, child.text
    summary = child.json()
    assert summary["program"]["document_ids"] == [a] and summary["parent_run_id"] == parent
    # the parent keeps what it read
    assert client.get(f"/api/runs/{parent}").json()["summary"]["program"]["document_ids"] == [a, b]
    # an empty set is a real choice, not "no change"
    none = client.post(url, json={"text": "No documents", "document_ids": []})
    assert none.status_code == 202 and none.json()["program"]["document_ids"] == []


def test_documents_are_refused_on_a_correction_that_could_not_read_them(client):
    a = upload(client, "a.txt", b"first").json()["id"]
    parent = _finished_run(client, {"program": {**BODY["program"], "document_ids": [a]}})
    wrong_node = client.post(
        f"/api/runs/{parent}/nodes/bear_case/corrections", json={"text": "x", "document_ids": [a]}
    )
    assert (
        wrong_node.status_code == 422
        and wrong_node.json()["error"]["code"] == "documents_need_ingest"
    )
    unknown = client.post(
        f"/api/runs/{parent}/nodes/ingest_user_input/corrections",
        json={"text": "x", "document_ids": ["doc_0123456789abcdef"]},
    )
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "unknown_document"
    # without the field a correction keeps the run's documents, as before
    kept = client.post(
        f"/api/runs/{parent}/nodes/ingest_user_input/corrections", json={"text": "recheck"}
    )
    assert kept.json()["program"]["document_ids"] == [a]


def _age(store: DocumentStore, document_id: str, days: float) -> None:
    import os
    import time

    then = time.time() - days * 86_400
    for suffix in (".bin", ".json"):
        os.utime(store.root / f"{document_id}{suffix}", (then, then))


def test_pruning_removes_only_old_files_that_no_run_names(tmp_path):
    store = DocumentStore(tmp_path / "docs")
    old_unused = store.save("old.txt", b"old and unused").id
    old_used = store.save("used.txt", b"old but used").id
    new_unused = store.save("new.txt", b"new and unused").id
    for doc in (old_unused, old_used):
        _age(store, doc, 30)
    removed = store.prune({old_used}, 7 * 86_400)
    assert removed == [old_unused]
    assert store.get(old_unused) is None
    assert store.get(old_used) is not None and store.get(new_unused) is not None
    assert not list((tmp_path / "docs").glob(f"{old_unused}*"))
    assert store.prune({old_used}, 7 * 86_400) == []  # nothing else is old enough
    assert DocumentStore(tmp_path / "missing").prune(set(), 0) == []


def test_uploading_the_same_bytes_again_keeps_a_file_from_being_pruned(tmp_path):
    store = DocumentStore(tmp_path / "docs")
    doc = store.save("a.txt", b"same bytes").id
    _age(store, doc, 30)
    store.save("a-again.txt", b"same bytes")
    assert store.prune(set(), 7 * 86_400) == []


async def test_the_files_in_use_are_the_ones_any_run_or_rerun_names(services):
    from app.contracts import ProgramInput, RunOptions
    from app.graph.lifecycle import create_run

    a = services.documents.save("a.txt", b"first").id
    b = services.documents.save("b.txt", b"second").id
    program = ProgramInput(
        indication="Alzheimer's disease", mechanism="BACE1 inhibition", document_ids=[a]
    )
    await create_run(services, program, RunOptions())
    assert await services.runs.document_ids_in_use() == {a}
    await create_run(services, program.model_copy(update={"document_ids": [a, b]}), RunOptions())
    assert await services.runs.document_ids_in_use() == {a, b}


def test_the_server_clears_stale_unused_uploads_when_it_starts(tmp_path, monkeypatch):
    from app.core.settings import get_settings

    root = get_settings().data_path / "documents"
    store = DocumentStore(root)
    stale = store.save("stale.txt", b"nobody uses me").id
    fresh = store.save("fresh.txt", b"uploaded a moment ago").id
    _age(store, stale, 30)
    with TestClient(create_app()) as client:
        assert client.get(f"/api/documents/{stale}").status_code == 404
        assert client.get(f"/api/documents/{fresh}").status_code == 200


def test_an_id_that_is_not_a_document_id_never_becomes_a_path(tmp_path):
    root = tmp_path / "store" / "docs"
    (tmp_path / "x.json").write_text(
        DocumentInfo(
            id="doc_0000000000000000", name="x.txt", kind="text", size_bytes=1
        ).model_dump_json()
    )
    (tmp_path / "x.bin").write_bytes(b"x")
    store = DocumentStore(root)
    assert store.get(r"..\..\x") is None and store.get("../../x") is None


def test_a_pdf_pypdf_trips_over_is_unreadable_not_a_crash(monkeypatch):
    from app.sources import documents

    def broken(_):
        raise IndexError("list index out of range")

    monkeypatch.setattr(documents, "PdfReader", broken)
    with pytest.raises(documents.DocumentUnreadable):
        documents.read_document(b"%PDF-1.4 broken", "pdf")
