import pytest
from pydantic import ValidationError

from app.contracts import (
    AssessmentMetric,
    AssessmentResult,
    CauseShare,
    EvidenceLedger,
    FailureMix,
    LedgerStep,
    Range,
    RiskAdjustment,
)


def r(low: float, base: float, high: float) -> Range:
    return Range(low=low, base=base, high=high)


def shares(**kw: float) -> list[CauseShare]:
    return [CauseShare(cause=c, share=r(s, s, s)) for c, s in kw.items()]  # type: ignore[arg-type]


def test_a_failure_mix_must_sum_to_one_name_each_cause_once_and_cite_a_source():
    ok = FailureMix(
        shares=shares(efficacy=0.6, safety=0.4), source="literature", basis="assumption"
    )
    assert ok.n_stopped == 0
    with pytest.raises(ValidationError, match="sum to 1"):
        FailureMix(shares=shares(efficacy=0.6, safety=0.6), source="twins", basis="assumption")
    with pytest.raises(ValidationError, match="twice"):
        FailureMix(
            shares=[*shares(efficacy=0.5), *shares(efficacy=0.5)],
            source="twins",
            basis="assumption",
        )
    with pytest.raises(ValidationError, match="citation"):
        FailureMix(shares=shares(efficacy=1.0), source="literature", basis="sourced")


def test_a_risk_adjustment_needs_a_positive_ratio_and_a_citation_when_sourced():
    RiskAdjustment(cause="safety", factor="f", risk_ratio=r(0.9, 1.0, 1.2), basis="assumption")
    with pytest.raises(ValidationError, match="positive"):
        RiskAdjustment(cause="safety", factor="f", risk_ratio=r(0.0, 1.0, 1.2), basis="assumption")
    with pytest.raises(ValidationError, match="citation"):
        RiskAdjustment(cause="safety", factor="f", risk_ratio=r(0.9, 1.0, 1.2), basis="sourced")


def step(direction: str, base: float) -> LedgerStep:
    return LedgerStep(
        factor="f", cause="efficacy", direction=direction,  # type: ignore[arg-type]
        risk_ratio=r(base, base, base), basis="assumption", pos_after=r(0.1, 0.1, 0.1),
    )  # fmt: skip


def test_a_ledger_step_direction_must_agree_with_its_risk_ratio():
    step("up", 0.8)
    step("down", 1.3)
    with pytest.raises(ValidationError, match="direction"):
        step("up", 1.3)
    with pytest.raises(ValidationError, match="direction"):
        step("down", 0.8)


def test_the_posterior_is_the_last_steps_position():
    prior = r(0.05, 0.1, 0.2)
    last = step("down", 1.2)
    EvidenceLedger(prior=prior, steps=[last], posterior=last.pos_after)
    with pytest.raises(ValidationError, match="last step"):
        EvidenceLedger(prior=prior, steps=[last], posterior=r(0.2, 0.3, 0.4))


def test_an_assessment_cannot_repeat_a_metric_and_sourced_metrics_cite():
    def metric(key: str) -> AssessmentMetric:
        return AssessmentMetric(key=key, label=key, basis="assumption")

    AssessmentResult(
        cause="safety",
        rating="unknown",
        headline="h",
        metrics=[metric("a"), metric("b")],
        produced_by="x",
    )
    with pytest.raises(ValidationError, match="twice"):
        AssessmentResult(
            cause="safety",
            rating="unknown",
            headline="h",
            metrics=[metric("a"), metric("a")],
            produced_by="x",
        )
    with pytest.raises(ValidationError, match="citation"):
        AssessmentMetric(key="k", label="l", basis="sourced")


def test_the_ledger_config_matches_the_fixture_and_labels_every_assumption():
    import json

    import yaml

    from app.core.settings import ROOT

    config = yaml.safe_load((ROOT / "backend" / "config" / "ledger.yaml").read_text())
    literature = config["failure_mix"]["literature"]
    mix = FailureMix(
        shares=[
            CauseShare(cause=c, share=Range(**{**s, "unit": "share"}))
            for c, s in literature["shares"].items()
        ],
        source="literature",
        basis="sourced",
        citation=" ".join(literature["citation"].split()),
    )
    fixture = json.loads((ROOT / "contracts/fixtures/report_bace1_alzheimers.json").read_text())
    shipped = FailureMix.model_validate(fixture["ledger"]["failure_mix"])
    assert {s.cause: s.share for s in mix.shares} == {s.cause: s.share for s in shipped.shares}
    for key, entry in config["risk_ratios"].items():
        assert entry.get("assumption") is True or entry.get("citation"), key
        assert 0 < entry["low"] <= entry["base"] <= entry["high"], key
        assert key.split(".")[0] in {s.cause for s in mix.shares}, key
