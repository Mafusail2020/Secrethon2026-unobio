from datetime import date
from pathlib import Path
from typing import Any

import duckdb
import pytest
import yaml

from app.contracts import (
    Correction,
    EvidenceLedger,
    Range,
    RiskAdjustment,
    TwinProgram,
    TwinStats,
    utcnow,
)
from app.core.settings import get_settings
from app.nodes import evidence_ledger
from app.nodes.valuation import apply_corrections
from app.quant.base_rates import area_for, base_rates
from app.quant.twin_stats import (
    Program,
    Trial,
    TwinData,
    beta_range,
    classify,
    collapse_salts,
    compute,
    failure_mix,
)
from app.quant.valuation import value
from app.quant.verdict import Inputs, decide

TODAY = date(2026, 10, 8)


def _conf(name: str) -> dict[str, Any]:
    return yaml.safe_load((get_settings().config_dir / f"{name}.yaml").read_text())


def _program(**kw) -> Program:
    defaults = dict(
        drug_id="CHEMBL1", drug="DRUGA", disease_id="D1", disease="disease", areas=[],
        max_stage="PHASE_3", drug_stage="PHASE_3",
    )  # fmt: skip
    return Program(**{**defaults, **kw})


def _trial(status: str | None, start: date | None, cats=(), why=None, phase="PHASE_3") -> Trial:
    return Trial(
        nct="NCT1", title=None, phase=phase, status=status, start=start, why=why,
        categories=list(cats),
    )  # fmt: skip


# --- outcome rules ---------------------------------------------------------------------------


def test_approved_running_and_stopped_programs_are_told_apart():
    approved = classify(_program(max_stage="APPROVAL"), TODAY)
    running = classify(
        _program(trials=[_trial("COMPLETED", date(2025, 1, 1))]), TODAY
    )  # started within 3 years
    stopped = classify(
        _program(
            trials=[
                _trial("TERMINATED", date(2015, 1, 1), ["Business_Administrative"]),
                _trial("TERMINATED", date(2016, 1, 1), ["Negative", "Safety_Sideeffects"], "tox"),
            ]
        ),
        TODAY,
    )
    assert (approved.status, running.status, stopped.status) == ("approved", "active", "stopped")
    assert stopped.stop_category == "safety" and stopped.why_stopped == "tox"
    assert not stopped.presumed


def test_inactivity_is_a_presumed_stop_unless_the_drug_is_approved_elsewhere():
    old = [_trial("COMPLETED", date(2019, 1, 1))]
    presumed = classify(_program(trials=list(old)), TODAY)
    assert presumed.status == "stopped" and presumed.presumed and presumed.stop_category is None
    # tafolecimab: approved in China, no approval record for the indication in Open Targets
    guarded = classify(_program(drug_stage="APPROVAL", trials=list(old)), TODAY)
    assert guarded.status == "unknown" and guarded.note


def test_salt_forms_collapse_into_one_program_with_the_best_outcome():
    programs = collapse_salts(
        [
            _program(drug="INCLISIRAN", status="stopped", max_stage="PHASE_3"),
            _program(drug_id="CHEMBL2", drug="INCLISIRAN SODIUM", status="approved",
                     max_stage="APPROVAL"),
        ]
    )  # fmt: skip
    assert len(programs) == 1 and programs[0].status == "approved"


# --- prior and failure mix ---------------------------------------------------------------------


def test_beta_prior_shrinks_toward_the_base_rate_and_is_repeatable():
    none_approved = beta_range(0, 4, 0.10)
    assert 0 < none_approved.low <= none_approved.base <= none_approved.high < 0.5
    assert none_approved == beta_range(0, 4, 0.10)
    no_data = beta_range(0, 0, 0.10)
    assert abs(no_data.base - 0.10) < 0.05  # pure base rate, wide
    many = beta_range(30, 30, 0.10)
    assert many.high - many.low < no_data.high - no_data.low
    assert 0.4 < many.base < 0.55


def test_failure_mix_uses_the_literature_until_enough_twins_have_a_stop_reason():
    conf = _conf("ledger")
    few = [_program(status="stopped", stop_category="efficacy") for _ in range(2)]
    assert failure_mix(few, conf).source == "literature"
    many = [_program(status="stopped", stop_category="efficacy") for _ in range(4)]
    many += [_program(status="stopped", stop_category="safety")]
    mix = failure_mix(many, conf)
    shares = {s.cause: s.share for s in mix.shares}
    assert mix.source == "twins" and mix.n_stopped == 5
    pk = conf["failure_mix"]["literature"]["shares"]["pk_exposure"]["base"]
    assert shares["pk_exposure"].base == pk  # stop reasons never name exposure
    assert abs(sum(s.base for s in shares.values()) - 1) < 0.02
    assert shares["efficacy"].base > shares["safety"].base > shares["commercial"].base == 0


def test_base_rates_follow_the_report_and_fall_back_to_name_keywords():
    neuro = base_rates(["nervous system disorder", "psychiatric disorder"], "Alzheimer disease")
    assert neuro.area == "neurology"
    assert abs(neuro.loa("phase1") - 0.591 * 0.297 * 0.574 * 0.832) < 1e-9
    assert neuro.loa("phase3") > neuro.loa("phase2") > neuro.loa("preclinical")
    area, note = area_for(["phenotype"], "Hypercholesterolemia")
    assert area == "metabolic" and note and "assumption" in note
    assert area_for([], "unheard-of syndrome")[0] == "all"


# --- the DuckDB join on a tiny synthetic release ------------------------------------------------


def _table(root: Path, name: str, columns: str, rows: list[tuple]) -> None:
    con = duckdb.connect()
    con.execute(f"CREATE TABLE t ({columns})")
    if rows:
        con.executemany(f"INSERT INTO t VALUES ({', '.join('?' * len(rows[0]))})", rows)
    (root / name).mkdir(parents=True)
    con.execute(f"COPY t TO '{(root / name / 'part.parquet').as_posix()}' (FORMAT parquet)")
    con.close()


@pytest.fixture
def release(tmp_path: Path) -> Path:
    cls = [{"label": "Aspartic protease", "level": "l5"}]
    _table(
        tmp_path, "target", "id VARCHAR, targetClass STRUCT(label VARCHAR, level VARCHAR)[]",
        [("T1", cls), ("T2", cls)],
    )  # fmt: skip
    _table(
        tmp_path, "disease",
        "id VARCHAR, name VARCHAR, descendants VARCHAR[], therapeuticAreas VARCHAR[],"
        " parents VARCHAR[]",
        [("D1", "disease one", ["D1a"], ["TA1"], ["TA1"]),
         ("D1a", "subtype", [], ["TA1"], ["D1"]), ("D2", "other", [], ["TA2"], ["TA2"])],
    )  # fmt: skip
    _table(
        tmp_path, "drug_molecule", "id VARCHAR, name VARCHAR, maximumClinicalStage VARCHAR",
        [("C1", "ALPHA", "PHASE_3"), ("C2", "BETA", "APPROVAL"), ("C3", "GAMMA", "PHASE_3"),
         ("C4", "DELTA", "PHASE_3")],
    )  # fmt: skip
    _table(
        tmp_path, "clinical_target", "drugId VARCHAR, targetId VARCHAR",
        [("C1", "T1"), ("C2", "T1"), ("C3", "T1"), ("C4", "T2")],
    )  # fmt: skip
    _table(
        tmp_path, "clinical_indication",
        "drugId VARCHAR, diseaseId VARCHAR, maxClinicalStage VARCHAR, clinicalReportIds VARCHAR[]",
        [("C1", "D1", "PHASE_3", ["nct1"]), ("C2", "D1a", "APPROVAL", ["nct2"]),
         ("C3", "D1", "PHASE_3", ["nct3"]), ("C3", "D2", "PHASE_2", ["nct4"]),
         ("C4", "D1", "PHASE_3", ["nct5"])],
    )  # fmt: skip
    ct = "ClinicalTrials.gov"
    _table(
        tmp_path, "clinical_report",
        "id VARCHAR, source VARCHAR, title VARCHAR, trialOfficialTitle VARCHAR,"
        " clinicalStage VARCHAR, trialOverallStatus VARCHAR, trialStartDate DATE,"
        " trialWhyStopped VARCHAR, trialStopReasonCategories VARCHAR[]",
        [
            ("nct1", ct, "t1", None, "PHASE_3", "TERMINATED", date(2015, 1, 1), "futility",
             ["Negative"]),
            ("nct2", ct, "t2", None, "PHASE_3", "COMPLETED", date(2014, 1, 1), None, []),
            ("nct3", ct, "t3", None, "PHASE_3", "TERMINATED", date(2016, 1, 1), "no effect",
             ["Negative"]),
            ("nct4", ct, "t4", None, "PHASE_2", "RECRUITING", date(2025, 6, 1), None, []),
            ("nct5", ct, "t5", None, "PHASE_3", "TERMINATED", date(2017, 1, 1), "tox",
             ["Safety_Sideeffects"]),
        ],
    )  # fmt: skip
    return tmp_path


def test_compute_matches_the_exact_indication_first_and_censors_running_programs(release):
    data = TwinData(release)
    base = base_rates(["nervous system disorder"], "disease one")
    result = compute(data, "T1", "D1", None, base, _conf("ledger"), today=TODAY)
    assert result.match_level == "exact_target_indication"
    statuses = {p.drug: p.status for p in result.programs}
    assert statuses == {"ALPHA": "stopped", "BETA": "approved", "GAMMA": "stopped"}  # D1 + D1a
    assert {p.drug for p in result.decided} == {"ALPHA", "BETA", "GAMMA"}
    assert result.prior.low < result.prior.base < result.prior.high

    dropped = compute(
        data, "T1", "D1", None, base, _conf("ledger"), today=TODAY, drop_drugs={"gamma"}
    )
    # two decided twins left on T1 is too few, so the class level (T2 shares T1's class) is used
    assert dropped.match_level == "target_class"
    assert {p.drug for p in dropped.programs} == {"ALPHA", "BETA", "DELTA"}
    assert any("Aspartic protease" in n for n in dropped.notes)
    data.close()


def test_a_subtype_counts_its_parent_diseases_programs_as_exact_twins(release):
    data = TwinData(release)
    base = base_rates(["nervous system disorder"], "subtype")
    result = compute(data, "T1", "D1a", None, base, _conf("ledger"), today=TODAY)
    assert result.match_level == "exact_target_indication"  # D1a alone has one twin
    assert {p.drug for p in result.decided} == {"ALPHA", "BETA", "GAMMA"}
    data.close()


# --- ledger ----------------------------------------------------------------------------------


class _Ctx:
    def __init__(self, corrections=()) -> None:
        self.node_id, self.logs, self._c = "evidence_ledger", [], list(corrections)

    def log(self, message: str, level: str = "info") -> None:
        self.logs.append(message)

    def corrections_for(self, node_id=None):
        return self._c


def _twin(level: str, prior: Range | None = None, twins=()) -> TwinStats:
    return TwinStats(
        match_level=level, n_programs=len(twins), twins=list(twins),
        prior_pos=prior or Range(low=0.02, base=0.05, high=0.1, unit="probability"),
    )  # fmt: skip


def _adjustment(factor: str, base: float, cause: str = "efficacy") -> RiskAdjustment:
    return RiskAdjustment(
        cause=cause, factor=factor, basis="assumption",
        risk_ratio=Range(low=min(base, 1.0) * 0.9, base=base, high=max(base, 1.0) * 1.1),
    )  # fmt: skip


async def test_ledger_skips_terminated_twins_when_the_prior_already_counts_them():
    adjustments = {
        "a": _adjustment("terminated twins", 1.15),
        "b": _adjustment("genetic support", 0.85),
    }
    exact = await evidence_ledger.run(
        {"twin_stats": _twin("exact_target_indication"), "risk_adjustments": adjustments},
        _Ctx(),  # type: ignore[arg-type]
    )
    area = await evidence_ledger.run(
        {"twin_stats": _twin("target_area"), "risk_adjustments": adjustments},
        _Ctx(),  # type: ignore[arg-type]
    )
    ledger_exact: EvidenceLedger = exact["ledger"]
    assert [s.factor for s in ledger_exact.steps] == ["genetic support"]
    assert len(area["ledger"].steps) == 2
    assert ledger_exact.posterior.base > area["ledger"].posterior.base
    p = ledger_exact.posterior
    assert p.low <= p.base <= p.high and p == ledger_exact.steps[-1].pos_after


async def test_ledger_drops_a_factor_a_correction_names():
    correction = Correction(
        id="c", run_id="r", node_id="evidence_ledger", text="ignore genetic support",
        created_at=utcnow(),
    )  # fmt: skip
    out = await evidence_ledger.run(
        {
            "twin_stats": _twin("target_area"),
            "risk_adjustments": {"b": _adjustment("genetic support", 0.85)},
        },
        _Ctx([correction]),  # type: ignore[arg-type]
    )
    assert out["ledger"].steps == []


# --- valuation -------------------------------------------------------------------------------


def test_valuation_ranges_are_ordered_and_preclinical_pays_for_ind_work():
    conf = _conf("valuation")
    base = base_rates(["nervous system disorder"], "Alzheimer disease")
    pos = Range(low=0.02, base=0.05, high=0.2, unit="probability")
    pre, _ = value("preclinical", pos, base, conf)
    p2, _ = value("phase2", pos, base, conf)
    for v in (pre, p2):
        for r in (v.capital_to_milestone, v.time_to_milestone_months, v.rnpv):
            assert r.low <= r.base <= r.high
    assert (
        pre.next_milestone == "IND and Phase 1 readout" and p2.next_milestone == "Phase 2 readout"
    )
    assert p2.capital_to_milestone.base > pre.capital_to_milestone.base
    better, _ = value("phase2", Range(low=0.2, base=0.4, high=0.6, unit="probability"), base, conf)
    assert better.rnpv.base > p2.rnpv.base
    cited = [a for a in p2.assumptions if a.basis == "sourced"]
    assert cited and all(a.citation for a in cited)


def test_valuation_corrections_read_amounts_written_in_words():
    conf = _conf("valuation")
    apply_corrections(conf, ["peak sales of 500 million", "cost per patient 30 thousand"], "cns")
    assert conf["peak_sales_usd"]["cns"]["base"] == 5e8
    assert conf["cost_per_patient_usd"]["base"] == 30_000


def test_valuation_corrections_edit_named_assumptions_only():
    conf = _conf("valuation")
    applied = apply_corrections(
        conf, ["cost per patient is $250k", "peak sales 2b", "discount rate 15%", "vibes"], "cns"
    )
    assert len(applied) == 3
    assert conf["cost_per_patient_usd"]["base"] == 250_000
    assert conf["peak_sales_usd"]["cns"]["high"] == 2e9
    assert conf["discount_rate"]["low"] == pytest.approx(0.15)


# --- verdict ---------------------------------------------------------------------------------


def _inputs(pos: Range, rnpv: Range, twin: TwinStats | None = None, corrections=()) -> Inputs:
    from app.contracts import Valuation

    return Inputs(
        ledger=EvidenceLedger(prior=pos, posterior=pos),
        valuation=Valuation(
            next_milestone="x", capital_to_milestone=Range(low=1, base=2, high=3),
            time_to_milestone_months=Range(low=1, base=2, high=3), rnpv=rnpv,
        ),
        twin=twin, claims={}, key_risks=[], assessments={}, corrections=list(corrections),
    )  # fmt: skip


GOOD_POS = Range(low=0.2, base=0.4, high=0.6, unit="probability")
GOOD_RNPV = Range(low=10e6, base=100e6, high=500e6, unit="USD")


def test_verdict_invests_only_when_every_rule_is_met():
    conf = _conf("verdict")
    assert decide(_inputs(GOOD_POS, GOOD_RNPV), conf).decision == "invest"
    spans_zero = Range(low=-50e6, base=20e6, high=300e6, unit="USD")
    conditional = decide(_inputs(GOOD_POS, spans_zero), conf)
    assert conditional.decision == "conditional" and conditional.conditions
    losing = Range(low=-300e6, base=-200e6, high=-10e6, unit="USD")
    assert decide(_inputs(GOOD_POS, losing), conf).decision == "do_not_invest"


def test_verdict_never_invests_blind_on_efficacy_or_safety():
    from app.contracts import AssessmentResult

    blind = AssessmentResult(
        cause="efficacy", rating="unknown", headline="h", produced_by="x"
    )  # an approved-stage program with no target once got invest on the base rate alone
    inputs = _inputs(GOOD_POS, GOOD_RNPV)
    inputs.assessments = {"efficacy": blind}
    verdict = decide(inputs, _conf("verdict"))
    assert verdict.decision == "conditional"
    assert any("usable efficacy evidence" in c for c in verdict.conditions)


def test_verdict_kill_flag_from_same_indication_efficacy_failures():
    stopped = [
        TwinProgram(drug=d, drug_id=d, disease="AD", max_stage="PHASE_3", status="stopped")
        for d in ("A", "B", "C")
    ]
    twin = TwinStats(
        match_level="exact_target_indication", n_programs=3, twins=stopped,
        stop_reasons={"Negative": 3}, stop_reason_categories={"Negative": "efficacy"},
        prior_pos=GOOD_POS,
    )  # fmt: skip
    verdict = decide(_inputs(GOOD_POS, GOOD_RNPV, twin), _conf("verdict"))
    assert verdict.decision == "do_not_invest"
    assert verdict.reason_codes[0].code == "TWIN_EFFICACY_FAILURES"
    assert len(verdict.reason_codes) <= 5


def test_verdict_reads_a_reported_failure_in_a_correction_and_ignores_other_text():
    conf = _conf("verdict")
    failure = Correction(
        id="c", run_id="r", node_id="verdict", text="the phase 2 was terminated for futility",
        created_at=utcnow(),
    )  # fmt: skip
    chatter = failure.model_copy(update={"text": "please double-check the market size"})
    assert decide(_inputs(GOOD_POS, GOOD_RNPV, corrections=[failure]), conf).decision == (
        "do_not_invest"
    )
    assert decide(_inputs(GOOD_POS, GOOD_RNPV, corrections=[chatter]), conf).decision == "invest"
    for text in ("the phase 2 was not terminated", "no safety signal in phase 1"):
        denial = failure.model_copy(update={"text": text})
        assert decide(_inputs(GOOD_POS, GOOD_RNPV, corrections=[denial]), conf).decision == "invest"


# --- regressions from the debug session ------------------------------------------------------


def test_an_approved_stage_program_does_not_break_the_beta_prior():
    prior = beta_range(6, 0, 1.0)  # base rate of 1 used to zero a Beta parameter
    assert 0 < prior.low <= prior.base <= prior.high <= 1


def test_open_targets_area_names_map_with_their_exact_spelling():
    assert area_for(["cardiovascular disorder"], "x")[0] == "cardiovascular"
    assert area_for(["hematologic disorder"], "x")[0] == "hematology"
    assert area_for(["endocrine system disorder", "phenotype"], "obesity disorder")[0] == (
        "endocrine"
    )
    assert area_for(["immune system disorder"], "psoriasis")[0] == "autoimmune"


def test_valuation_survives_a_corrected_cost_per_patient():
    conf = _conf("valuation")
    apply_corrections(conf, ["cost per patient is 300k"], "cns")
    v, _ = value(
        "phase2",
        Range(low=0.02, base=0.05, high=0.2, unit="probability"),
        base_rates(["nervous system disorder"], "Alzheimer disease"),
        conf,
    )
    cpp = next(a for a in v.assumptions if a.name.startswith("cost per patient"))
    assert cpp.value.base == 300_000 and cpp.basis == "assumption" and cpp.citation is None


async def test_ledger_drop_matches_a_factor_named_without_its_prefix():
    correction = Correction(
        id="c", run_id="r", node_id="evidence_ledger", text="ignore no human exposure data",
        created_at=utcnow(),
    )  # fmt: skip
    adjustments = {
        "p": _adjustment("FIXTURE: no human exposure data", 1.05, "pk_exposure"),
        "g": _adjustment("genetic support", 0.85),
    }
    out = await evidence_ledger.run(
        {"twin_stats": _twin("target_area"), "risk_adjustments": adjustments},
        _Ctx([correction]),  # type: ignore[arg-type]
    )
    assert [s.factor for s in out["ledger"].steps] == ["genetic support"]


async def test_twin_stats_without_a_target_uses_the_area_base_rate_not_the_fixture():
    from app.contracts import EntityRef, ProgramInput, ResolvedEntities
    from app.nodes import twin_stats

    class Ctx:
        node_id = "twin_stats"

        def __init__(self) -> None:
            self.logs: list[str] = []

        def log(self, message: str, level: str = "info") -> None:
            self.logs.append(message)

        def corrections_for(self, node_id=None):
            return []

    entities = ResolvedEntities(
        disease=EntityRef(id="MONDO_0005083", label="psoriasis", kind="disease"),
        therapeutic_areas=["immune system disorder"],
        confidence="low",
    )
    state = {
        "program": ProgramInput(indication="psoriasis", mechanism="novel mechanism xyz123"),
        "entities": entities,
    }
    out = await twin_stats.run(state, Ctx())  # type: ignore[arg-type]
    stats = out["twin_stats"]
    assert stats.match_level == "area_base_rate" and stats.twins == []
    assert stats.failure_mix and stats.failure_mix.source == "literature"
    assert not any("FIXTURE" in n for n in stats.notes)


def test_a_twin_is_dropped_only_when_the_drop_word_leads_to_it():
    from types import SimpleNamespace

    from app.nodes.twin_stats import _dropped_drugs

    def dropped(text: str) -> set[str]:
        ctx = SimpleNamespace(corrections_for=lambda: [SimpleNamespace(text=text)])
        return _dropped_drugs(ctx, ["VERUBECESTAT", "ATABECESTAT"])  # type: ignore[arg-type]

    assert dropped("exclude atabecestat and verubecestat") == {"ATABECESTAT", "VERUBECESTAT"}
    assert dropped("verubecestat stopped without efficacy") == set()


@pytest.mark.parametrize(
    ("text", "failure"),
    [
        ("not effective, terminated", True),
        ("No efficacy signal, program discontinued", True),
        ("no responders and development discontinued", True),
        ("the drug did not show toxicity", False),
        ("never put on clinical hold", False),
    ],
)
def test_a_negation_only_cancels_the_failure_word_right_after_it(text, failure):
    import re

    from app.quant.verdict import reports_failure

    words = re.compile(rf"\b({_conf('verdict')['corrections']['failure_words']})\b", re.I)
    assert reports_failure(text, words) is failure
