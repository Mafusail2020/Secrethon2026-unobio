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
