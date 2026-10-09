import time

import pytest
from fastapi.testclient import TestClient

from app.contracts import ProgramInput
from app.core.documents import DocumentStore
from app.core.settings import get_settings
from app.main import create_app
from app.nodes import ingest_user_input
from app.sources.documents import (
    DocumentUnreadable,
    document_records,
    pick_for_lanes,
    read_document,
)
from app.sources.web import WebClient
from app.store.fakes import InMemorySourceCache
from tests.test_data_nodes import FakeCtx, _registry, _state


def make_pdf(pages: list[str]) -> bytes:
    """A small valid PDF, one line of text per page; an empty string is a blank page."""
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    kids = []
    for i, text in enumerate(pages):
        page_no, content_no = 4 + 2 * i, 5 + 2 * i
        kids.append(f"{page_no} 0 R")
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 11 Tf 40 700 Td ({escaped}) Tj ET".encode() if text else b""
        objects[page_no] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_no} 0 R "
            "/Resources << /Font << /F1 3 0 R >> >> >>"
        ).encode()
        objects[content_no] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )
    objects[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>".encode()
    out = b"%PDF-1.4\n"
    offsets: dict[int, int] = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for number in sorted(objects):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    out += trailer.encode()
    return out


PAGES = [
    "BACE1 inhibitor lowered brain Abeta42 by 62 percent in mice at 10 mg/kg.",
    "Dosing was well tolerated. The liver enzyme ALT stayed within range at all doses.",
]
PROGRAM = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")


def test_a_pdf_is_read_page_by_page_with_the_page_in_each_locator():
    text = read_document(make_pdf(PAGES), "pdf")
    assert [(p.label, p.text) for p in text.pages] == [("p. 1", PAGES[0]), ("p. 2", PAGES[1])]
    assert text.truncated is False


def test_a_blank_page_is_skipped_but_keeps_its_number():
    text = read_document(make_pdf([PAGES[0], "", PAGES[1]]), "pdf")
    assert [p.label for p in text.pages] == ["p. 1", "p. 3"]


def test_a_pdf_with_no_text_or_no_structure_is_unreadable_and_says_why():
    with pytest.raises(DocumentUnreadable, match="no text layer"):
        read_document(make_pdf(["", ""]), "pdf")
    with pytest.raises(DocumentUnreadable, match="could not be read"):
        read_document(b"%PDF-1.4\nthis is not a pdf at all", "pdf")


def test_text_is_cut_into_parts_at_paragraph_breaks():
    paragraphs = ["Mouse study. " * 150, "Rat study. " * 150, "Short note."]
    text = read_document("\n\n".join(paragraphs).encode(), "text")
    assert [p.label for p in text.pages] == ["part 1", "part 2", "part 3"][: len(text.pages)]
    assert "Short note." in text.pages[-1].text
    with pytest.raises(DocumentUnreadable):
        read_document(b"  \n\n  ", "text")


def test_chunks_are_verbatim_slices_of_their_page_and_carry_stable_ids(tmp_path):
    store = DocumentStore(tmp_path)
    long_page = " ".join(f"Sentence number {i} reports a finding about BACE1." for i in range(120))
    info = store.save("study.pdf", make_pdf([long_page, PAGES[1]]))
    text = read_document(make_pdf([long_page, PAGES[1]]), "pdf")
    source, items = document_records(info, text, ["ENSG1"])
    assert source.type == "user_provided" and source.identifiers == {"document": info.id}
    assert source.title == "User document: study.pdf"
    assert {e.source_id for e in items} == {source.id} and all(
        e.entity_ids == ["ENSG1"] for e in items
    )
    first_page = [e for e in items if e.locator and e.locator.startswith("p. 1")]
    assert len(first_page) > 1 and first_page[0].locator == "p. 1 [1]"
    assert all(e.excerpt in long_page for e in first_page)
    assert [e.locator for e in items if e.locator == "p. 2"] == ["p. 2"]
    again = document_records(info, text, ["ENSG1"])[1]
    assert [e.id for e in again] == [e.id for e in items]


def test_the_chunks_handed_to_the_lanes_are_the_ones_about_the_program(tmp_path):
    info = DocumentStore(tmp_path).save("a.txt", b"x")
    text = read_document(
        make_pdf(["Unrelated budget table for the facility.", PAGES[0], "Lunch menu."]), "pdf"
    )
    _, items = document_records(info, text, [])
    picked = pick_for_lanes(items, PROGRAM, limit=1)
    assert [next(e.excerpt for e in items if e.id == i) for i in picked] == [PAGES[0]]
    # nothing about the program: the start of the document, within the limit
    plain = ProgramInput(indication="zzz", mechanism="yyy")
    assert len(pick_for_lanes(items, plain, limit=2)) == 2


def _ctx(corrections=()):
    web = WebClient("", InMemorySourceCache(), min_interval_s=0)
    return FakeCtx("ingest_user_input", _registry(web), corrections), web


def _program(*ids: str, notes: str | None = None) -> ProgramInput:
    return PROGRAM.model_copy(update={"document_ids": list(ids), "notes": notes})


def _store() -> DocumentStore:
    return DocumentStore(get_settings().data_path / "documents")


async def test_ingest_turns_a_pdf_into_cited_evidence_and_hands_the_lanes_the_best_chunks():
    ctx, web = _ctx()
    info = _store().save("BACE1 mouse study.pdf", make_pdf(PAGES))
    out = await ingest_user_input.run(
        _state(_program(info.id, notes="Our own note: Abeta fell 70%.")), ctx
    )
    docs = [s for s in ctx.sources_seen.values() if s.identifiers.get("document") == info.id]
    assert len(docs) == 1 and docs[0].type == "user_provided"
    mine = [e for e in ctx.evidence.values() if e.source_id == docs[0].id]
    assert sorted(e.locator or "" for e in mine) == ["p. 1", "p. 2"]
    handed = out["scratch"]["ingest_user_input"]["program_evidence_ids"]
    note = next(e.id for e in ctx.evidence.values() if e.excerpt.startswith("Our own note"))
    assert handed[0] == note and set(handed[1:]) <= {e.id for e in mine} and len(handed) > 1
    await web.aclose()


async def test_a_file_that_cannot_be_read_is_named_and_the_rest_still_count():
    ctx, web = _ctx()
    store = _store()
    good = store.save("good.pdf", make_pdf(PAGES))
    scan = store.save("scan.pdf", make_pdf(["", ""]))
    out = await ingest_user_input.run(_state(_program(good.id, scan.id)), ctx)
    facts = out["scratch"]["ingest_user_input"]
    assert facts["documents_unread"] == ["scan.pdf"]
    assert facts["documents_read"][good.id]["chunks"] == 2
    assert any(level == "warn" and "scan.pdf" in msg for level, msg in ctx.logs)
    assert any(s.identifiers.get("document") == good.id for s in ctx.sources_seen.values())
    await web.aclose()


async def test_a_document_that_has_gone_missing_is_skipped_with_a_warning():
    ctx, web = _ctx()
    out = await ingest_user_input.run(_state(_program("doc_0123456789abcdef")), ctx)
    assert ctx.evidence == {}
    assert out["scratch"]["ingest_user_input"]["documents_unread"] == ["doc_0123456789abcdef"]
    await web.aclose()


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
        yield client


def _finish(client: TestClient, run_id: str) -> dict:
    deadline = time.time() + 20
    while time.time() < deadline:
        detail = client.get(f"/api/runs/{run_id}").json()
        if detail["summary"]["status"] in ("completed", "failed"):
            return detail
        time.sleep(0.03)
    raise AssertionError("run did not finish")


def test_a_run_reports_the_uploaded_file_as_a_source_and_a_rerun_without_it_drops_it(client):
    from urllib.parse import quote

    upload = client.post(
        "/api/documents",
        content=make_pdf(PAGES),
        headers={"X-File-Name": quote("study.pdf")},
    ).json()
    body = {
        "program": {
            "indication": "Alzheimer's disease",
            "mechanism": "BACE1 inhibition",
            "document_ids": [upload["id"]],
        }
    }
    run = client.post("/api/runs", json=body).json()["id"]
    report = _finish(client, run)["report"]
    ours = [
        s for s in report["sources"].values() if s["identifiers"].get("document") == upload["id"]
    ]
    assert len(ours) == 1
    assert client.get(f"/api/runs/{run}/nodes/ingest_user_input").json()["status"] == "done"
    assert ours[0]["identifiers"]["chunks"].isdigit() and int(ours[0]["identifiers"]["chunks"]) >= 1

    child = client.post(
        f"/api/runs/{run}/nodes/ingest_user_input/corrections",
        json={"text": "Without the file", "document_ids": []},
    ).json()["id"]
    without = _finish(client, child)["report"]
    assert not any(s["identifiers"].get("document") for s in without["sources"].values())
