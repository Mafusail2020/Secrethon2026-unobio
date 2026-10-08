import json
import re
from math import log
from pathlib import Path
from urllib.parse import urlparse

import pytest

from app.contracts import GraphSpec, ProgramInput, RunEvent, UnderwritingReport
from app.graph.registry import get_registry
from app.graph.spec import build_graph_spec

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"
VERIFIED_NCTS = {"NCT01739348", "NCT01953601"}
ALLOWED_HOSTS = {"example.org", "clinicaltrials.gov"}


def _load(name: str):
    return json.loads((FIXTURES / name).read_text())


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _strings(v)
    elif isinstance(node, list):
        for item in node:
            yield from _strings(item)


@pytest.fixture(scope="module")
def report() -> UnderwritingReport:
    return UnderwritingReport.model_validate(_load("report_bace1_alzheimers.json"))


def test_program_fixture_validates():
    program = ProgramInput.model_validate(_load("program_bace1_alzheimers.json"))
    assert program.mechanism == "BACE1 inhibition"


def test_report_fixture_validates_and_is_synthetic(report: UnderwritingReport):
    assert report.meta.synthetic is True
    assert report.verdict.decision == "conditional"
    assert len(report.sections) == 9
    assert 5 <= len(report.diligence_questions) <= 10
    assert 3 <= len(report.verdict.reason_codes) <= 5


def test_report_references_resolve(report: UnderwritingReport):
    for claim in report.claims.values():
        if claim.status == "rejected":
            continue
        assert set(claim.evidence_ids) <= set(report.evidence), claim.id
        if claim.label in ("extracted", "derived"):
            assert claim.evidence_ids, f"{claim.id} is {claim.label} without evidence"
    for evidence in report.evidence.values():
        assert evidence.source_id in report.sources, evidence.id

    claim_ids = set(report.claims)
    referenced: list[str] = []
    for section in report.sections.values():
        referenced += [c for kp in section.key_points for c in kp.claim_ids]
    referenced += [c for link in report.translation_chain for c in link.claim_ids]
    referenced += [c for risk in report.key_risks for c in risk.claim_ids]
    referenced += [c for q in report.diligence_questions for c in q.claim_ids]
    referenced += [c for rc in report.verdict.reason_codes for c in rc.claim_ids]
    assert report.ledger is not None
    referenced += [c for step in report.ledger.steps for c in step.claim_ids]
    assert set(referenced) <= claim_ids
    for step in report.ledger.steps:
        assert set(step.evidence_ids) <= set(report.evidence)


def test_fixtures_contain_no_unverified_identifiers(report: UnderwritingReport):
    for name in ("report_bace1_alzheimers.json", "program_bace1_alzheimers.json"):
        text = list(_strings(_load(name)))
        joined = "\n".join(text)
        assert set(re.findall(r"NCT\d{8}", joined)) <= VERIFIED_NCTS
        for value in text:
            if value.startswith("http"):
                host = urlparse(value).hostname
                assert host in ALLOWED_HOSTS, value
                if host == "clinicaltrials.gov":
                    assert value.rsplit("/", 1)[-1] in VERIFIED_NCTS
    trial_status = report.evidence
    verified = [e for e in trial_status.values() if e.data and e.data.get("nct_id")]
    assert {e.data["nct_id"] for e in verified} == VERIFIED_NCTS
    assert all(e.data["overall_status"] == "TERMINATED" for e in verified)


def test_events_fixture_is_a_valid_run():
    lines = (FIXTURES / "events_bace1_alzheimers.jsonl").read_text().splitlines()
    events = [RunEvent.model_validate_json(line) for line in lines]
    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    assert events[0].type == "run.started"
    assert events[-1].type == "run.completed"
    registry = get_registry()
    started, completed = set(), set()
    for event in events:
        if event.node_id:
            assert event.node_id in registry and registry[event.node_id].run is not None
        if event.type == "node.started":
            started.add(event.node_id)
        if event.type == "node.completed":
            assert event.node_id in started
            completed.add(event.node_id)
    assert completed == started == {n for n, e in registry.items() if e.run is not None}


def test_graph_spec_fixture_matches_registry():
    fixture = GraphSpec.model_validate(_load("graph_spec.json"))
    assert fixture == build_graph_spec(), "run `make graph-spec`"


def test_ledger_steps_chain_to_the_posterior(report: UnderwritingReport):
    ledger = report.ledger
    assert ledger is not None and ledger.steps
    assert all(step.pos_after is not None for step in ledger.steps)
    assert ledger.steps[-1].pos_after == ledger.posterior == report.pos
    bases = [ledger.prior.base, *(s.pos_after.base for s in ledger.steps if s.pos_after)]
    for step, before, after in zip(ledger.steps, bases, bases[1:], strict=False):
        assert (after < before) == (step.direction == "down"), step.factor


def test_stop_reason_categories_only_describe_known_reasons(report: UnderwritingReport):
    twin = report.twin_stats
    assert twin is not None
    assert set(twin.stop_reason_categories) <= set(twin.stop_reasons)


def test_claims_are_authored_by_writers_never_gates(report: UnderwritingReport):
    producers = {c.produced_by for c in report.claims.values()}
    assert producers and not any(p.endswith("_claim_gate") for p in producers)
    registry = get_registry()
    assert producers <= set(registry)
    assert all(registry[p].spec.correctable for p in producers)


def test_assessment_lanes_cite_only_their_own_claims_and_cover_both_causes(
    report: UnderwritingReport,
):
    """Lanes run in parallel, so an adjustment may cite only its own lane's claims or evidence."""
    lane_of = {
        "efficacy": "efficacy_extract",
        "pk_exposure": "efficacy_extract",
        "safety": "safety_extract",
    }
    assert report.ledger is not None
    for step in report.ledger.steps:
        for claim_id in step.claim_ids:
            assert report.claims[claim_id].produced_by == lane_of[step.cause], step.factor
    assert {a.cause for a in report.assessments} == {"efficacy", "safety"}
    for assessment in report.assessments:
        assert assessment.produced_by == f"{assessment.cause}_score"
        for claim_id in assessment.claim_ids:
            assert report.claims[claim_id].produced_by == f"{assessment.cause}_extract"
        for metric in assessment.metrics:
            assert set(metric.evidence_ids) <= set(report.evidence)


def test_the_failure_mix_cites_its_source_and_the_ledger_splits_the_prior_by_it(
    report: UnderwritingReport,
):
    assert report.ledger is not None and report.twin_stats is not None
    mix = report.ledger.failure_mix
    assert mix is not None and mix == report.twin_stats.failure_mix
    assert mix.source == "literature" and mix.citation and "asbmb.org" in mix.citation
    by = {c.cause: c for c in report.ledger.by_cause}
    assert abs(sum(c.hazard_prior.base for c in by.values()) + log(report.ledger.prior.base)) < 1e-9
    assert by["safety"].risk_ratio.base > 1 and by["commercial"].risk_ratio.base == 1


def test_every_reason_names_a_cause_only_when_it_is_about_one(report: UnderwritingReport):
    causes = {r.code: r.cause for r in report.verdict.reason_codes}
    assert causes["SAFETY_LIABILITY"] == "safety" and causes["TARGET_LINK"] == "efficacy"
