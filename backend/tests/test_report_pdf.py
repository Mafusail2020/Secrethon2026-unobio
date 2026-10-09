import io
import json
import re
import time
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.contracts import UnderwritingReport
from app.main import create_app
from app.report_pdf.build import build_report_pdf
from tests.test_fixtures import FIXTURES

RAW = (FIXTURES / "report_bace1_alzheimers.json").read_text()
REPORT = UnderwritingReport.model_validate_json(RAW)
REAL = UnderwritingReport.model_validate_json(RAW.replace("FIXTURE:", "Real:")).model_copy(
    update={"meta": REPORT.meta.model_copy(update={"synthetic": False})}
)


def read(report: UnderwritingReport) -> tuple[PdfReader, str]:
    pdf = PdfReader(io.BytesIO(build_report_pdf(report)))
    return pdf, "\n".join(page.extract_text() or "" for page in pdf.pages)


def test_the_pdf_is_a_real_document_with_the_call_the_claims_and_the_sources():
    pdf, text = read(REPORT)
    assert len(pdf.pages) >= 3
    assert "BACE1 inhibition in Alzheimer's disease" in text
    assert "Conditional" in text and "3.9%" in text and "range 1.0% to 13%" in text
    for heading in (
        "What carries it",
        "What holds it back",
        "Will it work in people?",
        "The numbers behind it",
        "Sources",
        "Run details",
    ):
        assert heading in text
    kept = [c for c in REPORT.claims.values() if c.status != "rejected"]
    assert all(c.text in " ".join(text.split()) for c in kept[:6])
    assert "https://clinicaltrials.gov/study/NCT01739348" in text.replace("\n", "")


def test_a_claim_the_gate_rejected_is_shown_as_rejected_with_its_reason():
    _, text = read(REPORT)
    rejected = next(c for c in REPORT.claims.values() if c.status == "rejected")
    flat = " ".join(text.split())
    assert rejected.text in flat and "Rejected by the evidence gate" in flat


def test_every_source_number_in_the_text_is_in_the_numbered_list():
    _, text = read(REPORT)
    listed = {int(n) for n in re.findall(r"^\[(\d+)\] ", text, re.M)}
    # a locator such as safetyLiabilities[0] is not a source number: ours never touch a word
    cited = {int(n) for n in re.findall(r"(?<![\w\]])\[(\d+)\]", text)}
    assert listed and cited <= listed


def test_a_synthetic_report_says_so_on_every_page_and_a_real_one_does_not():
    pdf, _ = read(REPORT)
    assert all("Synthetic data" in (p.extract_text() or "") for p in pdf.pages)
    _, real = read(REAL)
    assert "Synthetic data" not in real


def test_text_with_markup_symbols_and_greek_letters_comes_out_as_written():
    claim = next(iter(REAL.claims.values())).model_copy(
        update={"text": "Aβ42 fell ≥ 60 % (−2 SD) <b>not bold</b> & <script>x</script>"}
    )
    report = REAL.model_copy(update={"claims": {**REAL.claims, claim.id: claim}})
    _, text = read(report)
    flat = " ".join(text.split())
    assert "Aβ42 fell ≥ 60 % (−2 SD) <b>not bold</b> & <script>x</script>" in flat


def test_a_thin_report_with_no_ledger_twins_valuation_or_assessments_still_builds():
    thin = REAL.model_copy(
        update={
            "ledger": None,
            "twin_stats": None,
            "valuation": None,
            "assessments": [],
            "key_risks": [],
            "critical_unknowns": [],
            "diligence_questions": [],
        }
    )
    pdf, text = read(thin)
    assert len(pdf.pages) >= 2 and "Conditional" in text


def test_a_report_with_no_claims_at_all_still_builds():
    empty = REAL.model_copy(update={"claims": {}, "evidence": {}, "sources": {}})
    _, text = read(empty)
    assert "Nothing found on this side." in text and "Sources" in text


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
        yield client


BODY = {"program": {"indication": "Alzheimer's disease", "mechanism": "BACE1 inhibition"}}


def test_the_endpoint_sends_the_pdf_as_a_download(client):
    run_id = client.post("/api/runs", json=BODY).json()["id"]
    early = client.get(f"/api/runs/{run_id}/report.pdf")
    assert early.status_code in (200, 409)  # a stub run can finish before the request lands
    for _ in range(400):
        if client.get(f"/api/runs/{run_id}").json()["summary"]["status"] == "completed":
            break
        time.sleep(0.03)
    response = client.get(f"/api/runs/{run_id}/report.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith(
        "attachment;"
    ) and "BACE1 inhibition in Alzheimer's disease" in unquote(disposition)
    assert (
        response.content.startswith(b"%PDF-")
        and len(PdfReader(io.BytesIO(response.content)).pages) >= 2
    )


def test_the_endpoint_needs_a_finished_run_and_a_real_one(client):
    assert client.get("/api/runs/run_missing/report.pdf").status_code == 404
    from app.graph.lifecycle import (
        create_run,  # noqa: F401  (the run is started below through the API)
    )

    services = client.app.state.services
    services.settings.stub_delay_scale = 5.0
    run_id = client.post("/api/runs", json=BODY).json()["id"]
    refused = client.get(f"/api/runs/{run_id}/report.pdf")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "run_not_completed"


LONG = (
    "the pharmacological inhibition of beta-secretase cleavage of the amyloid precursor protein "
    "reduced cerebrospinal fluid Aβ42 by about 80 % in mild-to-moderate patients yet did not slow "
    "cognitive decline over 24 months, which points to timing rather than target engagement as the "
    "limiting factor"
)
STANCES = ("pro", "con", "neutral")
LABELS = ("extracted", "inferred", "derived", "hypothesis", "modeled")
CONFIDENCES = ("high", "medium", "low")


def _source(i: int) -> tuple[dict, dict]:
    sid, eid = f"src_{i:016x}", f"ev_{i:016x}"
    url = f"https://clinicaltrials.gov/api/v2/studies/NCT{i:08d}?fields=" + "a" * 200
    source = {
        "id": sid,
        "type": "trial",
        "title": f"Real: study {i} of {LONG[:90]}",
        "url": url,
        "publisher": "ClinicalTrials.gov",
        "published_at": None,
        "retrieved_at": "2026-10-05T12:00:00Z",
        "identifiers": {},
    }
    evidence = {
        "id": eid,
        "source_id": sid,
        "excerpt": LONG * 3,
        "locator": f"protocolSection.module.WithAVeryLongLocatorThatDoesNotBreak[{i}]",
        "entity_ids": [],
        "kind": "text",
        "data": None,
    }
    return source, evidence


def _claim(k: int, section: str, sources: int) -> dict:
    rejected = k % 11 == 5
    return {
        "id": f"clm_{k:016x}",
        "text": f"Real: {LONG[: 120 + (k * 37) % 180]}",
        "section": section,
        "stance": STANCES[k % 3],
        "label": LABELS[k % 5],
        "evidence_ids": [f"ev_{(k + d) % sources:016x}" for d in range(1 + k % 3)],
        "confidence": CONFIDENCES[k % 3],
        "produced_by": "section_analysts",
        "status": "rejected" if rejected else "accepted",
        "rejection_reason": "cited evidence does not support the claim" if rejected else None,
    }


def crowded(per_section: int, sources: int = 40) -> UnderwritingReport:
    """A report shaped like a big real one: many claims of every stance, long quotes and URLs."""
    raw = json.loads(RAW.replace("FIXTURE:", "Real:"))
    raw["meta"]["synthetic"] = False
    pairs = [_source(i) for i in range(sources)]
    raw["sources"] = {s["id"]: s for s, _ in pairs}
    raw["evidence"] = {e["id"]: e for _, e in pairs}
    claims = (
        _claim(i * per_section + j, section, sources)
        for i, section in enumerate(raw["sections"])
        for j in range(per_section)
    )
    raw["claims"] = {c["id"]: c for c in claims}
    return UnderwritingReport.model_validate(raw)


@pytest.mark.parametrize("per_section", [7, 40])
def test_a_big_report_still_builds_and_stays_readable(per_section):
    # a table cell cannot split across pages: a long For or Against list used to raise LayoutError
    report = crowded(per_section)
    pdf, text = read(report)
    pages = [(page.extract_text() or "") for page in pdf.pages]
    assert len(pdf.pages) > 10
    assert all("Unobio underwriting" in p and "Page " in p for p in pages)
    assert all(len(p) > 400 for p in pages[:-1]), "a page that is nearly empty"
    listed = {int(n) for n in re.findall(r"^\[(\d+)\] ", text, re.M)}
    cited = {int(n) for n in re.findall(r"(?<![\w\]])\[(\d+)\]", text)}
    assert listed == set(range(1, 41)) and cited <= listed
    assert "more, listed in the sections below" in text


def test_every_claim_is_in_the_sections_even_when_the_case_boxes_show_only_the_heaviest():
    report = crowded(7)
    _, text = read(report)
    flat = " ".join(text.split())
    assert sum(flat.count(c.text[:60]) for c in report.claims.values()) >= len(report.claims)
    assert flat.count("Rejected by the evidence gate") == sum(
        c.status == "rejected" for c in report.claims.values()
    )


def test_the_numbers_after_a_claim_read_in_order():
    _, text = read(crowded(7))
    for group in re.findall(r"((?:\[\d+\] ?){2,})", text):
        numbers = [int(n) for n in re.findall(r"\d+", group)]
        assert numbers == sorted(numbers)
