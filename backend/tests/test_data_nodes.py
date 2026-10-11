import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.contracts import (
    Correction,
    EntityRef,
    ProgramInput,
    ResolvedEntities,
    RunOptions,
    utcnow,
)
from app.llm.types import EffortKnobs
from app.nodes import fetch_opentargets, fetch_trials, ingest_user_input, input_resolver
from app.nodes.input_resolver import parse_mechanism
from app.sources.base import SourceRegistry
from app.sources.clinicaltrials import ClinicalTrialsClient
from app.sources.opentargets import OpenTargetsClient
from app.sources.web import WebClient
from app.store.fakes import InMemorySourceCache

FIXTURES = Path(__file__).parent / "fixtures" / "sources"
OT_URL = "https://api.platform.opentargets.org/api/v4/graphql"
CT_URL = "https://clinicaltrials.gov/api/v2"

BACE1 = EntityRef(id="ENSG00000186318", label="BACE1", kind="target")
AD = EntityRef(id="MONDO_0004975", label="Alzheimer disease", kind="disease")


class FakeCtx:
    def __init__(self, node_id: str, sources: SourceRegistry, corrections=()) -> None:
        self.run_id, self.node_id = "run_test", node_id
        self.effort = EffortKnobs("medium", retrieval_k=8, n_queries=4, max_tokens=1024, tier="c")
        self.sources = sources
        self.corrections = list(corrections)
        self.logs: list[tuple[str, str]] = []
        self.sources_seen: dict[str, Any] = {}
        self.evidence: dict[str, Any] = {}

    def log(self, message: str, level: str = "info") -> None:
        self.logs.append((level, message))

    def progress(self, message: str) -> None:
        self.logs.append(("info", message))

    def corrections_for(self, node_id: str | None = None) -> list[Correction]:
        return [c for c in self.corrections if c.node_id == (node_id or self.node_id)]

    async def register_sources(self, sources):
        self.sources_seen.update((s.id, s) for s in sources)
        return [s.id for s in sources]

    async def register_evidence(self, evidence):
        self.evidence.update((e.id, e) for e in evidence)
        return [e.id for e in evidence]


def _registry(*clients) -> SourceRegistry:
    registry = SourceRegistry()
    for c in clients:
        registry.register(c)
    return registry


def _ot() -> OpenTargetsClient:
    return OpenTargetsClient(OT_URL, InMemorySourceCache(), min_interval_s=0)


def _ct() -> ClinicalTrialsClient:
    return ClinicalTrialsClient(CT_URL, InMemorySourceCache(), min_interval_s=0, attempts=1)


def _graphql_replay(request: httpx.Request) -> httpx.Response:
    """Serves recorded Open Targets answers, keyed by operation name (+ entity for search)."""
    recorded = json.loads((FIXTURES / "opentargets_bace1.json").read_text())
    body = json.loads(request.content)
    operation = body["query"].split("query ", 1)[1].split("(", 1)[0]
    if operation == "Search":
        operation += ":" + body["variables"]["entities"][0]
    return httpx.Response(200, json=recorded[operation])


def _state(program: ProgramInput, corrections=(), entities=None) -> dict[str, Any]:
    return {
        "program": program,
        "options": RunOptions(),
        "corrections": list(corrections),
        "entities": entities,
    }


def _correction(node_id: str, **kw) -> Correction:
    return Correction(
        id="cor_1",
        run_id="run_test",
        node_id=node_id,
        text=kw.pop("text", "fix"),
        created_at=utcnow(),
        **kw,
    )


@pytest.mark.parametrize(
    ("text", "candidates", "action"),
    [
        ("BACE1 inhibition", ["BACE1"], "inhibitor"),
        ("beta-secretase 1 inhibitor", ["beta-secretase 1"], "inhibitor"),
        ("anti-PCSK9 monoclonal antibody", ["PCSK9"], "antibody"),
        ("GLP-1 receptor agonist", ["GLP-1 receptor", "GLP-1"], "agonist"),
    ],
)
def test_parse_mechanism_strips_actions_but_keeps_punctuation(text, candidates, action):
    assert parse_mechanism(text) == (candidates, action)


@respx.mock
async def test_input_resolver_resolves_real_ids_from_open_targets():
    respx.post(OT_URL).mock(side_effect=_graphql_replay)
    ctx = FakeCtx("input_resolver", _registry(_ot()))
    program = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")
    out = await input_resolver.run(_state(program), ctx)
    entities: ResolvedEntities = out["entities"]
    assert entities.disease.id == "MONDO_0004975" and entities.target
    assert entities.target.id == "ENSG00000186318" and entities.target.label == "BACE1"
    assert entities.mechanism_class == "inhibitor" and entities.confidence == "high"
    assert "nervous system disorder" in entities.therapeutic_areas


async def test_input_resolver_falls_back_to_fixture_without_clients():
    ctx = FakeCtx("input_resolver", SourceRegistry())
    program = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")
    out = await input_resolver.run(_state(program), ctx)
    assert out["entities"].disease.id.startswith("FIXTURE:")


@respx.mock
async def test_fetch_opentargets_registers_association_profile_and_landscape():
    respx.post(OT_URL).mock(side_effect=_graphql_replay)
    ctx = FakeCtx("fetch_opentargets", _registry(_ot()))
    entities = ResolvedEntities(disease=AD, target=BACE1, confidence="high")
    program = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")
    out = await fetch_opentargets.run(_state(program, entities=entities), ctx)
    facts = out["scratch"]["fetch_opentargets"]
    assert facts["genetic_association"] is None and facts["target_drugs"] == 4
    excerpts = [e.excerpt for e in ctx.evidence.values()]
    assert any("No genetic_association evidence" in x for x in excerpts)
    assert any(x.startswith("VERUBECESTAT") for x in excerpts)
    assert all(e.source_id in ctx.sources_seen for e in ctx.evidence.values())


@respx.mock
async def test_fetch_trials_registers_trials_and_honours_exclusions():
    recorded = json.loads((FIXTURES / "clinicaltrials_lanabecestat.json").read_text())
    respx.get(f"{CT_URL}/studies").mock(return_value=httpx.Response(200, json=recorded))
    entities = ResolvedEntities(disease=AD, target=None, confidence="medium")
    program = ProgramInput(
        indication="Alzheimer's disease", mechanism="BACE1", drug_name="lanabecestat"
    )

    ctx = FakeCtx("fetch_trials", _registry(_ct()))
    out = await fetch_trials.run(_state(program, entities=entities), ctx)
    stopped = out["scratch"]["fetch_trials"]["stopped"]
    assert [s["nct_id"] for s in stopped] == ["NCT02783573"]
    why = [e for e in ctx.evidence.values() if e.locator == "statusModule.whyStopped"]
    assert len(why) == 1 and "independent assessment" in why[0].excerpt

    correction = _correction("fetch_trials", exclude_evidence_ids=[why[0].id])
    ctx2 = FakeCtx("fetch_trials", _registry(_ct()), [correction])
    await fetch_trials.run(_state(program, [correction], entities), ctx2)
    assert why[0].id not in ctx2.evidence and len(ctx2.evidence) == len(ctx.evidence) - 1


@respx.mock
async def test_fetch_trials_is_fail_soft_when_the_api_is_down():
    respx.get(f"{CT_URL}/studies").mock(return_value=httpx.Response(503))
    entities = ResolvedEntities(disease=AD, target=None, confidence="medium")
    program = ProgramInput(
        indication="Alzheimer's disease", mechanism="x", drug_name="lanabecestat"
    )
    ctx = FakeCtx("fetch_trials", _registry(_ct()))
    await fetch_trials.run(_state(program, entities=entities), ctx)
    assert ctx.evidence == {} and any(level == "warn" for level, _ in ctx.logs)


async def test_ingest_user_input_turns_notes_into_evidence_and_refuses_private_links():
    web = WebClient("", InMemorySourceCache(), min_interval_s=0)
    ctx = FakeCtx("ingest_user_input", _registry(web))
    program = ProgramInput(
        indication="Alzheimer's disease",
        mechanism="BACE1 inhibition",
        notes="Brain Abeta fell 70% in rats at 10 mg/kg.",
        links=["http://127.0.0.1/secret"],
    )
    out = await ingest_user_input.run(_state(program), ctx)
    assert [e.excerpt for e in ctx.evidence.values()] == [
        "Brain Abeta fell 70% in rats at 10 mg/kg."
    ]
    assert {s.type for s in ctx.sources_seen.values()} == {"user_provided"}
    assert out["scratch"]["ingest_user_input"]["links_unread"] == ["http://127.0.0.1/secret"]
    await web.aclose()


@respx.mock
async def test_search_retries_without_the_hyphen_open_targets_cannot_match():
    seen: list[str] = []

    def reply(request: httpx.Request) -> httpx.Response:
        q = json.loads(request.content)["variables"]["q"]
        seen.append(q)
        hits = [] if "-" in q else [{"id": "ENSG00000186318", "name": "BACE1", "score": 5.0}]
        return httpx.Response(200, json={"data": {"search": {"hits": hits}}})

    respx.post(OT_URL).mock(side_effect=reply)
    hits = await _ot().search("BACE-1", "target")
    assert seen == ["BACE-1", "BACE1"] and hits[0]["name"] == "BACE1"


def test_a_near_tie_between_matches_is_low_confidence():
    from app.nodes.input_resolver import _confidence

    def hits(*scores):
        return [{"id": str(i), "name": str(i), "score": s} for i, s in enumerate(scores)]

    assert _confidence(hits(573, 492)) == "low"  # anemia of CKD -> Fanconi anemia
    assert _confidence(hits(900, 492)) == "medium"
    assert _confidence(hits(5000, 500)) == "high"


@respx.mock
async def test_a_public_link_cannot_redirect_the_server_to_a_private_address(monkeypatch):
    from app.sources import web as web_module
    from app.sources.base import SourceError

    async def public(url: str) -> bool:  # no DNS in tests: only the metadata address is private
        return "169.254.169.254" not in url

    monkeypatch.setattr(web_module, "_public_host", public)
    respx.get("https://public.example/r").mock(
        return_value=httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})
    )
    metadata = respx.get("http://169.254.169.254/latest/").mock(return_value=httpx.Response(200))
    web = WebClient("", InMemorySourceCache(), min_interval_s=0)
    with pytest.raises(SourceError, match="refusing"):
        await web.fetch_text("https://public.example/r")
    assert not metadata.called
    await web.aclose()


@respx.mock
async def test_a_redirect_to_another_public_page_is_followed(monkeypatch):
    from app.sources import web as web_module

    async def public(url: str) -> bool:
        return True

    monkeypatch.setattr(web_module, "_public_host", public)
    respx.get("https://public.example/old").mock(
        return_value=httpx.Response(301, headers={"location": "/new"})
    )
    respx.get("https://public.example/new").mock(
        return_value=httpx.Response(200, text="moved here", headers={"content-type": "text/plain"})
    )
    web = WebClient("", InMemorySourceCache(), min_interval_s=0)
    page = await web.fetch_text("https://public.example/old")
    assert page is not None and page["text"] == "moved here"
    assert page["url"] == "https://public.example/new"
    await web.aclose()


@respx.mock
async def test_a_redirect_loop_or_a_broken_location_is_an_error_not_a_crash(monkeypatch):
    from app.sources import web as web_module
    from app.sources.base import SourceError

    async def public(url: str) -> bool:
        return True

    monkeypatch.setattr(web_module, "_public_host", public)
    respx.get("https://public.example/loop").mock(
        return_value=httpx.Response(302, headers={"location": "/loop"})
    )
    respx.get("https://public.example/bad").mock(
        return_value=httpx.Response(302, headers={"location": "http://[bad/"})
    )
    web = WebClient("", InMemorySourceCache(), min_interval_s=0)
    with pytest.raises(SourceError, match="too many redirects"):
        await web.fetch_text("https://public.example/loop")
    with pytest.raises(SourceError):
        await web.fetch_text("https://public.example/bad")
    await web.aclose()


class _FakeDiseaseSearch:
    def __init__(self, hits):
        self.hits = hits

    async def search(self, text, entity, size=5, *, force_refresh=False):
        return self.hits

    async def disease(self, efo_id, *, force_refresh=False):
        name = next(h["name"] for h in self.hits if h["id"] == efo_id)
        return {"id": efo_id, "name": name, "therapeuticAreas": []}


async def test_plain_multiple_sclerosis_is_the_term_open_targets_files_it_under():
    from app.nodes.input_resolver import _disease

    ms = [
        {"id": "EFO_0803536", "name": "multiple sclerosis symptom measurement", "score": 4110.0},
        {"id": "MONDO_0005284", "name": "chronic progressive multiple sclerosis", "score": 783.0},
        {"id": "MONDO_0005314", "name": "relapsing-remitting multiple sclerosis", "score": 708.0},
    ]
    ref, _, confidence = await _disease(
        _FakeDiseaseSearch(ms),
        "multiple sclerosis",
        None,
        FakeCtx("input_resolver", _registry()),
        False,
    )
    assert (ref.id, ref.label, confidence) == ("EFO_0803536", "multiple sclerosis", "high")
    # a measurement that is not the disease itself stays out
    pd = [
        {"id": "MONDO_0005180", "name": "Parkinson disease", "score": 3833.0},
        {"id": "EFO_0600011", "name": "Parkinson's disease symptom measurement", "score": 644.0},
    ]
    ref, _, _ = await _disease(
        _FakeDiseaseSearch(pd),
        "Parkinson's disease",
        None,
        FakeCtx("input_resolver", _registry()),
        False,
    )
    assert ref.id == "MONDO_0005180"
    ad = [
        {"id": "EFO_0006514", "name": "Alzheimer's disease biomarker measurement", "score": 900.0},
        {"id": "MONDO_0004975", "name": "Alzheimer disease", "score": 800.0},
    ]
    ref, _, _ = await _disease(
        _FakeDiseaseSearch(ad),
        "Alzheimer's disease",
        None,
        FakeCtx("input_resolver", _registry()),
        False,
    )
    assert ref.id == "MONDO_0004975"


def test_trial_reports_are_searched_by_the_drug_names_on_the_target_too():
    from app.nodes.fetch_literature import build_queries

    queries = dict(
        build_queries("BTK", None, ["multiple sclerosis"], ["tolebrutinib", "evobrutinib"])
    )
    assert queries["clinical results"].startswith('("BTK" OR "tolebrutinib" OR "evobrutinib") AND')
    assert queries["clinical results"].endswith('PUB_TYPE:"Clinical Trial")')
    assert queries["target and disease"] == '("BTK") AND ("multiple sclerosis")'


def test_queries_build_without_class_drugs():
    from app.nodes.fetch_literature import build_queries

    queries = dict(build_queries("BTK", None, ["multiple sclerosis"]))
    assert queries["clinical results"].startswith('("BTK") AND')


async def test_class_drugs_are_the_targets_drugs_in_this_disease_most_advanced_first():
    from types import SimpleNamespace

    from app.nodes.fetch_literature import _class_drugs
    from app.sources.base import SourceError

    def row(name, stage, *diseases):
        return {
            "maxClinicalStage": stage,
            "drug": {"id": name, "name": name.upper()} if name else None,
            "diseases": [{"disease": {"id": d} if d else None} for d in diseases],
        }

    class FakeOt(OpenTargetsClient):
        rows: list = []

        async def target_drugs(self, ensembl_id, *, force_refresh=False):
            if self.rows is None:
                raise SourceError("down")
            return self.rows

    ot = FakeOt(OT_URL, InMemorySourceCache(), min_interval_s=0)
    ot.rows = [
        row("evobrutinib", "PHASE_3", "EFO_MS"),
        row("ibrutinib", "APPROVAL", "EFO_CLL"),  # another disease
        row("tolebrutinib", None, "EFO_MS", None),
        row(None, "PHASE_2", "EFO_MS"),
        row("fenebrutinib", "PHASE_3", "EFO_MS"),
        row("remibrutinib", "PHASE_1", "EFO_MS"),
    ]
    entities = SimpleNamespace(target=SimpleNamespace(id="T"), disease=SimpleNamespace(id="EFO_MS"))
    ctx = FakeCtx("fetch_literature", _registry(ot))
    assert await _class_drugs(ctx, entities, False, limit=3) == [
        "evobrutinib",
        "fenebrutinib",
        "remibrutinib",
    ]
    ot.rows = None
    assert await _class_drugs(ctx, entities, False) == []
    assert ctx.logs[-1][0] == "warn"
    no_target = SimpleNamespace(target=None, disease=entities.disease)
    assert await _class_drugs(ctx, no_target, False) == []
    await ot.aclose()


async def test_the_symptom_rule_never_beats_a_real_term():
    from app.nodes.input_resolver import _disease

    ctx = FakeCtx("input_resolver", _registry())
    real_too = [
        {"id": "EFO_0803536", "name": "multiple sclerosis symptom measurement", "score": 4110.0},
        {"id": "MONDO_0005301", "name": "multiple sclerosis", "score": 900.0},
    ]
    ref, _, _ = await _disease(_FakeDiseaseSearch(real_too), "multiple sclerosis", None, ctx, False)
    assert ref.id == "MONDO_0005301"
    not_top = [
        {"id": "MONDO_0005314", "name": "relapsing-remitting multiple sclerosis", "score": 900.0},
        {"id": "EFO_0803536", "name": "multiple sclerosis symptom measurement", "score": 800.0},
    ]
    ref, _, _ = await _disease(_FakeDiseaseSearch(not_top), "multiple sclerosis", None, ctx, False)
    assert ref.id == "MONDO_0005314"
