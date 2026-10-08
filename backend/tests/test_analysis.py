import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.contracts import (
    SECTION_IDS,
    Claim,
    Correction,
    EntityRef,
    Evidence,
    PlannedQuestion,
    ProgramInput,
    Range,
    ResolvedEntities,
    RunOptions,
    SourceRef,
    TranslationLink,
    TwinStats,
    utcnow,
)
from app.contracts.ids import evidence_id, source_id
from app.llm.types import EffortKnobs, LLMParseError, LLMResult, LLMTask
from app.nodes import fetch_safety, question_planner, section_analysts
from app.nodes._analysis import QUOTE_MISSING, DraftClaim, gate, quote_found, to_claims
from app.nodes.subgraphs import assessments, bull_bear
from app.quant.assessment import EfficacyInputs, SafetyInputs, score_efficacy, score_safety
from app.sources.base import SourceRegistry
from app.sources.openfda import OpenFDAClient
from app.sources.opentargets import OpenTargetsClient
from app.store.fakes import InMemorySourceCache, InMemoryStore, RunRetriever

FIXTURES = Path(__file__).parent / "fixtures" / "sources"
OT_URL = "https://api.platform.opentargets.org/api/v4/graphql"
FDA_URL = "https://api.fda.gov"

BACE1 = EntityRef(id="ENSG00000186318", label="BACE1", kind="target")
AD = EntityRef(id="MONDO_0004975", label="Alzheimer disease", kind="disease")
ENTITIES = ResolvedEntities(disease=AD, target=BACE1, confidence="high")
PROGRAM = ProgramInput(indication="Alzheimer's disease", mechanism="BACE1 inhibition")


class FakeLLM:
    """Canned structured replies by purpose; records every task it saw."""

    def __init__(self, replies: dict[str, Any] | None = None) -> None:
        self.replies = replies or {}
        self.tasks: list[LLMTask] = []

    async def complete(self, task: LLMTask) -> LLMResult:
        self.tasks.append(task)
        reply = self.replies.get(task.purpose)
        if isinstance(reply, Exception):
            raise reply
        assert task.schema is not None
        parsed = task.schema.model_validate(reply or {}) if reply is not None else None
        if parsed is None:
            parsed = task.schema.model_validate(_empty(task.schema))
        return LLMResult("fake", "{}", parsed, 10, 10, None, False, 1)


def _empty(schema) -> dict[str, Any]:
    return {"summary": "nothing"} if "summary" in schema.model_fields else {}


class FakeCtx:
    def __init__(self, node_id: str, store: InMemoryStore, llm: FakeLLM | None = None, **kw):
        self.run_id, self.node_id = "run_test", node_id
        self.effort = EffortKnobs("medium", retrieval_k=8, n_queries=4, max_tokens=1024, tier="c")
        self.store = store
        self.llm = llm or FakeLLM()
        self.sources = kw.get("sources") or SourceRegistry()
        self.corrections: list[Correction] = list(kw.get("corrections", []))
        self.retriever = RunRetriever(store, kw.get("allowed", []))
        self.logs: list[tuple[str, str]] = []
        self.evidence: dict[str, Evidence] = {}

    def log(self, message: str, level: str = "info") -> None:
        self.logs.append((level, message))

    def progress(self, message: str) -> None:
        self.logs.append(("info", message))

    def corrections_for(self, node_id: str | None = None) -> list[Correction]:
        return [c for c in self.corrections if c.node_id == (node_id or self.node_id)]

    async def register_sources(self, sources):
        await self.store.evidence.put_sources(sources)
        return [s.id for s in sources]

    async def register_evidence(self, evidence):
        await self.store.evidence.put_evidence(evidence)
        self.evidence.update((e.id, e) for e in evidence)
        return [e.id for e in evidence]


def _ev(text: str, key: str) -> tuple[SourceRef, Evidence]:
    source = SourceRef(
        id=source_id("paper", key),
        type="paper",
        title=f"Paper {key}",
        publisher="Journal",
        retrieved_at=utcnow(),
    )
    return source, Evidence(
        id=evidence_id(source.id, text, "abstract"),
        source_id=source.id,
        excerpt=text,
        locator="abstract",
    )


TEXTS = {
    "fail": "The phase 3 trial of verubecestat was terminated for futility after interim analysis.",
    "tox": "Liver enzyme elevations and hepatotoxicity were observed with BACE1 inhibitors.",
    "gen": "Genetic variants protective against amyloid production support BACE1 as a target.",
    "worse": "In the BACE1 clinical trial, cognitive decline was worse in the verubecestat group.",
}


async def _store() -> tuple[InMemoryStore, dict[str, str]]:
    store = InMemoryStore()
    ids = {}
    for key, text in TEXTS.items():
        source, ev = _ev(text, key)
        await store.evidence.put_sources([source])
        await store.evidence.put_evidence([ev])
        await store.vectors.add([ev])
        ids[key] = ev.id
    return store, ids


def _state(evidence_ids: list[str], **extra) -> dict[str, Any]:
    return {
        "program": PROGRAM,
        "options": RunOptions(),
        "corrections": [],
        "entities": ENTITIES,
        "evidence_ids": evidence_ids,
        **extra,
    }


def _correction(node_id: str, **kw) -> Correction:
    return Correction(id="cor_1", run_id="run_test", node_id=node_id, created_at=utcnow(), **kw)


def _claim(**kw) -> DraftClaim:
    return DraftClaim(**{"section": "clinical_plan", "label": "extracted", **kw})


# --- quote gate ---------------------------------------------------------------------------------


def test_quote_must_appear_verbatim_ignoring_case_space_and_quotes():
    text = TEXTS["fail"]
    assert quote_found("terminated  for FUTILITY", [text])
    assert quote_found("“was terminated for futility”", [text])
    assert not quote_found("stopped for futility", [text])
    assert not quote_found("futility", [text])  # too short to prove anything


def test_quote_tolerates_typographic_dashes_and_ellipsis_joins():
    text = "BACE1 × AD: overall association score 0.422; lit 0.99. No genetic_association evidence."
    assert quote_found(
        "overall association score 0.422; ... No genetic_association evidence.", [text]
    )
    assert quote_found("amyloid‑beta production", ["the amyloid-beta production step"])
    assert not quote_found("score 0.422 … no genetic support", [text])


async def test_gate_rejects_unknown_ids_and_downgrades_bad_quotes():
    store, ids = await _store()
    ctx = FakeCtx("bear_claim_gate", store)
    claims, quotes = to_claims(
        [
            _claim(
                text="Verubecestat failed for futility.",
                evidence_ids=[ids["fail"]],
                quote="terminated for futility",
            ),
            _claim(text="Made-up quote.", evidence_ids=[ids["fail"]], quote="halted for harm"),
            _claim(
                text="Invented id.", evidence_ids=["ev_0000000000000000"], quote="whatever text"
            ),
            _claim(text="Amyloid is upstream of tau.", label="hypothesis"),
        ],
        "bear_claim_writer",
        "con",
    )
    gated = await gate(ctx, claims, quotes, set(ids.values()))
    by_text = {c.text: c for c in gated.values()}
    assert by_text["Verubecestat failed for futility."].status == "accepted"
    bad = by_text["Made-up quote."]
    assert (
        bad.status == "downgraded"
        and bad.label == "unknown"
        and bad.rejection_reason == QUOTE_MISSING
    )
    assert by_text["Invented id."].status == "rejected"
    hypothesis = by_text["Amyloid is upstream of tau."]
    assert hypothesis.status == "accepted" and hypothesis.confidence == "low"
    assert all(c.stance == "con" and c.produced_by == "bear_claim_writer" for c in gated.values())


# --- question planner ---------------------------------------------------------------------------


def test_plan_questions_keeps_model_order_and_fills_skipped_sections():
    Q = question_planner._Question
    drafted = [
        Q(section="safety", question="Is BACE1 inhibition hepatotoxic?", rationale="r", priority=1),
        Q(
            section="safety",
            question="  Does it cause   retinal toxicity? ",
            rationale="r",
            priority=2,
        ),
        Q(section="translation", question="Is CSF Abeta lowered?", rationale="r", priority=3),
        *(Q(section="safety", question=f"extra {i}", rationale="r", priority=9) for i in range(5)),
    ]
    questions, defaulted = question_planner.plan_questions(drafted, "AD", "BACE1 inhibition")
    assert {q.section for q in questions} == set(SECTION_IDS)
    assert [q.priority for q in questions] == list(range(1, len(questions) + 1))
    assert questions[0].question == "Is BACE1 inhibition hepatotoxic?"
    assert questions[1].question == "Does it cause retinal toxicity?"
    assert sum(q.section == "safety" for q in questions) == question_planner.MAX_PER_SECTION
    assert len({q.id for q in questions}) == len(questions)
    assert "safety" not in defaulted and "capital" in defaulted
    assert not any(q.question.startswith("FIXTURE") for q in questions)


async def test_question_planner_survives_an_unusable_reply():
    store, _ = await _store()
    llm = FakeLLM({"question_planner.plan": LLMParseError("bad json")})
    ctx = FakeCtx("question_planner", store, llm)
    out = await question_planner.run(_state([]), ctx)
    assert {q.section for q in out["questions"]} == set(SECTION_IDS)
    assert any(level == "warn" for level, _ in ctx.logs)


# --- bull / bear --------------------------------------------------------------------------------


async def test_bear_case_end_to_end_cites_only_retrieved_evidence():
    store, ids = await _store()
    allowed = list(ids.values())
    nodes = bull_bear.make_nodes("bear")
    llm = FakeLLM(
        {
            "bear_query_planner.plan": {"queries": ["verubecestat futility", "hepatotoxicity"]},
            "bear_claim_writer.draft": {
                "claims": [
                    _claim(
                        text="The verubecestat phase 3 trial was stopped for futility.",
                        evidence_ids=[ids["fail"]],
                        quote="was terminated for futility",
                    ).model_dump(),
                    _claim(
                        text="BACE1 inhibitors raise liver enzymes.",
                        section="safety",
                        evidence_ids=[ids["tox"]],
                        quote="Liver enzyme elevations",
                    ).model_dump(),
                ]
            },
        }
    )
    state = _state(allowed)
    for step in ("query_planner", "retriever", "claim_writer", "claim_gate"):
        node_id = f"bear_{step}"
        out = await nodes[node_id](state, FakeCtx(node_id, store, llm, allowed=allowed))
        for key, value in out.items():
            state[key] = {**state.get(key, {}), **value} if isinstance(value, dict) else value

    queries = state["scratch"]["bear_query_planner"]["queries"]
    assert queries[:2] == ["verubecestat futility", "hepatotoxicity"]
    assert any("terminated futility" in q for q in queries)  # contradiction templates always run
    assert {ids["fail"], ids["tox"]} <= set(state["scratch"]["bear_retriever"]["evidence_ids"])
    claims = state["claims"]
    assert len(claims) == 2 and all(
        c.status == "accepted" and c.stance == "con" for c in claims.values()
    )
    writer_task = next(t for t in llm.tasks if t.purpose == "bear_claim_writer.draft")
    assert f"[{ids['fail']}]" in writer_task.user


async def test_bear_gate_rejects_claims_on_evidence_a_correction_excluded():
    store, ids = await _store()
    claims, quotes = to_claims(
        [
            _claim(
                text="Stopped for futility.",
                evidence_ids=[ids["fail"]],
                quote="terminated for futility",
            )
        ],
        "bear_claim_writer",
        "con",
    )
    scratch = {
        "bear_claim_writer": {
            "claims": [c.model_dump(mode="json") for c in claims],
            "quotes": quotes,
            "evidence_ids": [ids["fail"]],
        }
    }
    exclusion = _correction("fetch_trials", text="exclude it", exclude_evidence_ids=[ids["fail"]])
    state = _state(list(ids.values()), scratch=scratch, corrections=[exclusion])
    out = await bull_bear.make_nodes("bear")["bear_claim_gate"](
        state, FakeCtx("bear_claim_gate", store)
    )
    assert [c.status for c in out["claims"].values()] == ["rejected"]


def test_rank_hits_prefers_items_found_by_several_queries():
    assert bull_bear.rank_hits([["a", "b"], ["b", "c"], ["c", "b"]], 2) == ["b", "c"]


# --- lanes --------------------------------------------------------------------------------------

CONF = {
    "risk_ratios": {
        "efficacy.genetic_support": {"low": 0.7, "base": 0.85, "high": 0.95, "assumption": True},
        "efficacy.terminated_twins": {"low": 1.05, "base": 1.15, "high": 1.35, "assumption": True},
        "efficacy.unproven_translation": {"low": 1.0, "base": 1.1, "high": 1.3, "assumption": True},
        "efficacy.contradicted_translation": {
            "low": 1.1,
            "base": 1.3,
            "high": 1.6,
            "assumption": True,
        },
        "efficacy.human_proof_of_concept": {
            "low": 0.6,
            "base": 0.75,
            "high": 0.9,
            "assumption": True,
        },
        "pk_exposure.no_human_exposure": {
            "low": 1.0,
            "base": 1.05,
            "high": 1.2,
            "assumption": True,
        },
        "pk_exposure.human_exposure_shown": {
            "low": 0.7,
            "base": 0.85,
            "high": 0.95,
            "assumption": True,
        },
        "safety.target_liability": {"low": 1.0, "base": 1.15, "high": 1.4, "assumption": True},
        "safety.boxed_warning_same_target": {
            "low": 1.05,
            "base": 1.2,
            "high": 1.4,
            "assumption": True,
        },
        "safety.tolerated_same_target": {
            "low": 0.75,
            "base": 0.85,
            "high": 0.95,
            "assumption": True,
        },
    },
    "assessment": {
        "genetic_support_min_score": {"value": 0.1},
        "rating_cutoffs": {"strong": 0.75, "moderate": 0.95, "weak": 1.15},
    },
}


def _chain(**statuses: str) -> list[TranslationLink]:
    return [
        TranslationLink(
            step=s, status=statuses.get(s, "missing"), claim_ids=["clm_x"] if s in statuses else []
        )  # type: ignore[arg-type]
        for s in assessments.TRANSLATION_STEPS
    ]


def _twins(match_level: str, **stops: int) -> TwinStats:
    return TwinStats(
        match_level=match_level,  # type: ignore[arg-type]
        n_programs=4,
        prior_pos=Range(low=0.05, base=0.1, high=0.15, unit="probability"),
        stop_reasons={k: v for k, v in stops.items()},
        stop_reason_categories={k: k for k in stops},  # type: ignore[misc]
    )


def test_efficacy_score_from_genetics_chain_and_twins():
    adjustments, result = score_efficacy(
        EfficacyInputs(
            genetic_score=0.4,
            association_score=0.6,
            association_evidence_ids=["ev_a"],
            chain=_chain(molecular_effect="supported", human_exposure="contradicted"),
            claim_ids=["clm_x"],
            twins=_twins("target_any", efficacy=2),
        ),
        CONF,
        "efficacy_score",
    )
    factors = {a.cause: [] for a in adjustments}
    for a in adjustments:
        factors[a.cause].append(a.factor)
    assert any("genetic support" in f for f in factors["efficacy"])
    assert any("contradicts" in f for f in factors["efficacy"])
    assert any("terminated" in f for f in factors["efficacy"])
    assert factors["pk_exposure"] == ["no human exposure data at the target tissue"]
    assert all(a.basis == "assumption" and "config" in a.inputs for a in adjustments)
    assert result.rating == "concerning" and result.headline.startswith("Efficacy concerning")
    assert {m.key for m in result.metrics} >= {"genetic_support", "chain_supported_share"}


def test_efficacy_score_without_a_chain_does_not_penalise_translation():
    adjustments, result = score_efficacy(EfficacyInputs(), CONF, "efficacy_score")
    assert adjustments == [] and result.rating == "unknown"
    assert "translation chain not assessed" in result.gaps


def test_efficacy_score_rewards_human_proof_of_concept():
    adjustments, result = score_efficacy(
        EfficacyInputs(chain=_chain(human_exposure="supported", patient_benefit="supported")),
        CONF,
        "efficacy_score",
    )
    assert {a.risk_ratio.base for a in adjustments} == {0.75, 0.85}
    assert result.rating == "strong"


def test_safety_score_boxed_warning_versus_clean_label():
    boxed, result = score_safety(
        SafetyInputs(
            liabilities=["hepatotoxicity"],
            liability_evidence_ids=["ev_l"],
            same_target_approved=["drugx"],
            labels_checked={"drugx": ["ev_lab"]},
            boxed_warnings={"drugx": ["ev_box"]},
        ),
        CONF,
        "safety_score",
    )
    assert [a.risk_ratio.base for a in boxed] == [1.15, 1.2] and result.rating == "concerning"
    clean, result = score_safety(
        SafetyInputs(same_target_approved=["drugx"], labels_checked={"drugx": ["ev_lab"]}),
        CONF,
        "safety_score",
    )
    assert [a.factor.split(" (")[0] for a in clean] == [
        "same-target drug approved without a boxed warning"
    ]
    assert result.rating == "moderate"


def test_settle_chain_drops_steps_whose_claims_did_not_survive():
    ok = Claim(
        id="c1",
        text="t",
        section="translation",
        stance="pro",
        label="extracted",
        confidence="high",
        produced_by="efficacy_extract",
    )
    weak = ok.model_copy(
        update={
            "id": "c2",
            "status": "downgraded",
            "label": "unknown",
            "rejection_reason": QUOTE_MISSING,
        }
    )
    gone = ok.model_copy(update={"id": "c3", "status": "rejected"})
    chain = [
        TranslationLink(step="molecular_effect", status="supported", claim_ids=["c1"]),
        TranslationLink(step="human_exposure", status="supported", claim_ids=["c2"]),
        TranslationLink(step="target_engagement", status="contradicted", claim_ids=["c3"]),
    ]
    settled = assessments.settle_chain(chain, {"c1": ok, "c2": weak, "c3": gone})
    assert [link.status for link in settled] == ["supported", "weak", "missing"]


async def test_efficacy_lane_end_to_end_writes_chain_adjustments_and_assessment():
    store, ids = await _store()
    allowed = list(ids.values())
    nodes = assessments.make_nodes("efficacy")
    llm = FakeLLM(
        {
            "efficacy_extract.extract": {
                "claims": [
                    _claim(
                        text="Genetic variants support BACE1 as a target.",
                        section="scientific_thesis",
                        stance="pro",
                        evidence_ids=[ids["gen"]],
                        quote="Genetic variants protective against amyloid production",
                    ).model_dump(),
                    _claim(
                        text="Patients on verubecestat declined faster than on placebo.",
                        section="translation",
                        stance="con",
                        evidence_ids=[ids["worse"]],
                        quote="cognitive decline was worse in the verubecestat group",
                    ).model_dump(),
                ],
                "chain": [
                    {"step": "molecular_effect", "status": "supported", "claims": [0]},
                    {"step": "patient_benefit", "status": "contradicted", "claims": [1, 7]},
                ],
            }
        }
    )
    state = _state(
        allowed,
        twin_stats=_twins("exact_target_indication", efficacy=3),
        scratch={
            "fetch_opentargets": {
                "association_score": 0.5,
                "genetic_association": None,
                "association_evidence_ids": [ids["gen"]],
            }
        },
    )
    for step in ("gather", "extract", "gate", "score"):
        node_id = f"efficacy_{step}"
        out = await nodes[node_id](state, FakeCtx(node_id, store, llm, allowed=allowed))
        for key, value in out.items():
            state[key] = {**state.get(key, {}), **value} if isinstance(value, dict) else value

    chain = {link.step: link for link in state["translation_chain"]}
    assert len(chain) == 5 and chain["patient_benefit"].status == "contradicted"
    assert len(chain["patient_benefit"].claim_ids) == 1  # the out-of-range index is dropped
    assert chain["human_exposure"].status == "missing"
    adjustments = state["risk_adjustments"]
    assert "efficacy:evidence-contradicts-the-translation-chain-patient-benefit" in adjustments
    # exact-match twins are already in the prior: no terminated-twins adjustment
    assert not any("terminated" in k for k in adjustments)
    assessment = state["assessments"]["efficacy"]
    assert set(assessment.claim_ids) == set(state["claims"])


# --- section analysts ---------------------------------------------------------------------------


def test_section_points_need_a_surviving_claim():
    drafted = section_analysts.SectionDraft(
        summary="  Two   points. ",
        key_points=[
            section_analysts._Point(text="backed", claim_ids=["clm_a"]),
            section_analysts._Point(text="new one", claim_ids=["new:0", "new:5"]),
            section_analysts._Point(text="unbacked", claim_ids=["clm_missing"]),
        ],
        unknowns=["window"],
    )
    result = section_analysts.settle_section(
        "safety", drafted, ["clm_new"], {"clm_a", "clm_new"}, None
    )
    assert [p.claim_ids for p in result.key_points] == [["clm_a"], ["clm_new"]]
    assert result.status == "partial" and result.summary == "Two points."
    empty = section_analysts.settle_section("safety", None, [], set(), None)
    assert empty.status == "insufficient_evidence" and empty.unknowns


async def test_section_analysts_write_every_section_and_settle_risks():
    store, ids = await _store()
    allowed = list(ids.values())
    existing = Claim(
        id="clm_fail",
        text="Verubecestat stopped for futility.",
        section="clinical_plan",
        stance="con",
        label="extracted",
        evidence_ids=[ids["fail"]],
        confidence="high",
        produced_by="bear_claim_writer",
    )
    section = {
        "summary": "Earlier BACE1 programs failed.",
        "key_points": [
            {"text": "Phase 3 futility", "claim_ids": ["clm_fail"]},
            {"text": "Liver signal", "claim_ids": ["new:0"]},
        ],
        "new_claims": [
            _claim(
                text="BACE1 inhibitors raised liver enzymes.",
                section="risks",
                evidence_ids=[ids["tox"]],
                quote="Liver enzyme elevations",
            ).model_dump()
        ],
        "unknowns": [],
    }
    risks = {
        **section,
        "key_risks": [
            {
                "category": "efficacy",
                "text": "Futility again",
                "severity": "high",
                "claim_ids": ["clm_fail"],
            },
            {"category": "ip", "text": "Patent thicket", "severity": "low", "claim_ids": []},
        ],
        "critical_unknowns": ["Is there a therapeutic window?"],
        "diligence_questions": [
            {
                "question": f"Q{i}",
                "why_it_matters": "w",
                "requires": ["kol_interview"],
                "priority": 13 - i,
                "claim_ids": ["clm_fail", "clm_bogus"],
            }
            for i in range(12)
        ],
    }
    replies = {f"section_analysts.{s}": section for s in SECTION_IDS if s != "risks"}
    replies["section_analysts.risks"] = risks
    llm = FakeLLM(replies)
    questions = [
        PlannedQuestion(
            id=f"q_{s}",
            section=s,
            question="BACE1 liver enzyme elevations",
            rationale="r",
            priority=i,
        )
        for i, s in enumerate(SECTION_IDS, 1)
    ]
    state = _state(allowed, claims={"clm_fail": existing}, questions=questions)
    out = await section_analysts.run(
        state, FakeCtx("section_analysts", store, llm, allowed=allowed)
    )

    assert set(out["sections"]) == set(SECTION_IDS)
    clinical = out["sections"]["clinical_plan"]
    assert clinical.status == "ok" and clinical.key_points[0].claim_ids == ["clm_fail"]
    # a section's new claims get that section, whatever the model said
    assert {c.section for c in out["claims"].values()} <= set(SECTION_IDS)
    assert all(c.produced_by == "section_analysts" for c in out["claims"].values())
    assert [r.text for r in out["key_risks"]] == ["Futility again"]
    assert "unsupported risk: Patent thicket" in out["critical_unknowns"]
    assert len(out["diligence_questions"]) == section_analysts.MAX_DILIGENCE
    assert out["diligence_questions"][0].question == "Q11"
    assert all(q.claim_ids == ["clm_fail"] for q in out["diligence_questions"])
    assert len([t for t in llm.tasks if t.purpose.startswith("section_analysts.")]) == 9


# --- fetch_safety -------------------------------------------------------------------------------


def _operation(request: httpx.Request) -> str:
    return json.loads(request.content)["query"].split("query ", 1)[1].split("(", 1)[0]


@respx.mock
async def test_fetch_safety_registers_liabilities_labels_and_faers():
    # pretend one BACE1 inhibitor got approved, so there is a same-target label to read
    recorded = json.loads((FIXTURES / "opentargets_bace1.json").read_text())
    rows = recorded["TargetDrugs"]["data"]["target"]["drugAndClinicalCandidates"]["rows"]
    rows[0]["maxClinicalStage"] = "APPROVAL"
    respx.post(OT_URL).mock(side_effect=lambda r: httpx.Response(200, json=recorded[_operation(r)]))
    label = {
        "set_id": "set-1",
        "openfda": {"generic_name": ["VERUBECESTAT"]},
        "boxed_warning": ["WARNING: HEPATOTOXICITY"],
        "adverse_reactions": ["Rash and falls."],
    }
    respx.get(f"{FDA_URL}/drug/label.json").mock(
        return_value=httpx.Response(200, json={"results": [label]})
    )
    respx.get(f"{FDA_URL}/drug/event.json").mock(
        return_value=httpx.Response(200, json={"results": [{"term": "FALL", "count": 12}]})
    )
    registry = SourceRegistry()
    registry.register(OpenTargetsClient(OT_URL, InMemorySourceCache(), min_interval_s=0))
    registry.register(OpenFDAClient(FDA_URL, InMemorySourceCache(), min_interval_s=0))
    store = InMemoryStore()
    ctx = FakeCtx("fetch_safety", store, sources=registry)
    out = await fetch_safety.run(_state([]), ctx)

    facts = out["scratch"]["fetch_safety"]
    assert facts["liabilities"] == ["regulation of catalytic activity"]
    assert facts["same_target_approved"] == ["verubecestat"]
    assert list(facts["boxed_warning_evidence_ids"]) == ["verubecestat"]
    excerpts = [e.excerpt for e in ctx.evidence.values()]
    assert any("Safety liability for BACE1" in x for x in excerpts)
    assert "WARNING: HEPATOTOXICITY" in excerpts
    assert any("fall (12)" in x and "not incidence" in x for x in excerpts)
    sources = await store.evidence.get_sources(list({e.source_id for e in ctx.evidence.values()}))
    faers = next(s for s in sources if s.title.startswith("FDA adverse event reports"))
    assert faers.url and faers.url.startswith("https://api.fda.gov/drug/event.json?search=")


async def test_fetch_safety_falls_back_to_fixture_without_clients():
    ctx = FakeCtx("fetch_safety", InMemoryStore())
    fixture_entities = ENTITIES.model_copy(
        update={"disease": AD.model_copy(update={"id": "FIXTURE:x"})}
    )
    out = await fetch_safety.run({**_state([]), "entities": fixture_entities}, ctx)
    assert out == {}


@pytest.mark.parametrize("lane", ["efficacy", "safety"])
async def test_lane_score_uses_only_its_own_claims(lane):
    store, ids = await _store()
    foreign = Claim(
        id="clm_bull",
        text="t",
        section="translation",
        stance="pro",
        label="extracted",
        evidence_ids=[ids["gen"]],
        confidence="high",
        produced_by="bull_claim_writer",
    )
    state = _state(list(ids.values()), claims={"clm_bull": foreign})
    node = assessments.make_nodes(lane)[f"{lane}_score"]
    out = await node(state, FakeCtx(f"{lane}_score", store))
    assert out["assessments"][lane].claim_ids == []


async def test_a_refused_long_input_is_retried_smaller():
    from app.nodes._analysis import DraftClaims, ask_fitted

    class Refuses(FakeLLM):
        async def complete(self, task):
            if len(self.tasks) == 0:
                self.tasks.append(task)
                raise RuntimeError("400: Input exceeds the conservative input limit.")
            return await super().complete(task)

    llm = Refuses()
    ctx = FakeCtx("bull_claim_writer", InMemoryStore(), llm)
    scales: list[float] = []

    async def build(scale: float) -> tuple[str, list[str]]:
        scales.append(scale)
        return "x" * int(100 * scale), [f"ev_{scale}"]

    parsed, _, shown = await ask_fitted(ctx, "p", "s", build, DraftClaims, 100)
    assert scales == [1.0, 0.6] and shown == ["ev_0.6"] and parsed is not None
    assert any("input too long" in m for _, m in ctx.logs)


def test_modality_is_read_from_the_mechanism_text():
    from app.quant.assessment import infer_modality

    assert infer_modality("DMD exon 51 skipping antisense") == "oligonucleotide"
    assert infer_modality("anti-PCSK9 monoclonal antibody") == "antibody"
    assert infer_modality("association with AAV gene therapy") == "gene_therapy"
    assert infer_modality("BACE1 inhibition") is None  # 'association' is not 'aso'


def test_safety_ignores_labels_of_another_modality():
    adjustments, result = score_safety(
        SafetyInputs(
            same_target_approved=["elevidys", "eteplirsen"],
            labels_checked={"elevidys": ["ev_1"], "eteplirsen": ["ev_2"]},
            boxed_warnings={"elevidys": ["ev_1"]},
            modality="oligonucleotide",
            drug_modalities={"elevidys": "gene_therapy", "eteplirsen": "oligonucleotide"},
        ),
        CONF,
        "safety_score",
    )
    assert [a.factor for a in adjustments] == [
        "same-target drug approved without a boxed warning (eteplirsen)"
    ]
    assert "elevidys (gene_therapy)" in result.headline


def test_cancer_genetic_support_counts_somatic_evidence():
    adjustments, result = score_efficacy(
        EfficacyInputs(somatic_score=0.92, cancer=True, association_score=0.8), CONF, "e"
    )
    assert adjustments[0].inputs["somatic_mutation"] == 0.92
    assert "(somatic)" in result.headline
    adjustments, _ = score_efficacy(
        EfficacyInputs(somatic_score=0.62, association_score=0.8), CONF, "e"
    )
    assert adjustments == []  # outside cancer somatic hits do not count


def test_a_base_rate_prior_alone_rates_unknown():
    twins = _twins("area_base_rate").model_copy(update={"n_programs": 0})
    _, efficacy = score_efficacy(EfficacyInputs(twins=twins), CONF, "e")
    _, safety = score_safety(SafetyInputs(twins=twins, fetched=False), CONF, "s")
    assert efficacy.rating == safety.rating == "unknown"


async def test_reply_caps_stay_within_what_the_gateway_accepts():
    from app.nodes._analysis import MAX_OUT_TOKENS, OUT_TOKENS, DraftClaims, ask

    llm = FakeLLM()
    ctx = FakeCtx("section_analysts", InMemoryStore(), llm)
    await ask(ctx, "p", "s", "u", DraftClaims, 10_000)
    assert llm.tasks[0].max_tokens == MAX_OUT_TOKENS
    assert max(OUT_TOKENS.values()) <= MAX_OUT_TOKENS
