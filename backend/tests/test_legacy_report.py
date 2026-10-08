import copy
import json

import pytest

from app.contracts import UnderwritingReport
from app.core.legacy_report import upgrade_delta, upgrade_report
from app.nodes._fixture import FIXTURE_PATH


def _as_stored_before(report: dict, *, keep_pos_after: bool) -> dict:
    """The current fixture with its ledger written the way it used to be."""
    old = copy.deepcopy(report)
    for step in old["ledger"]["steps"]:
        ratio = step.pop("risk_ratio")
        step["likelihood_ratio"] = {
            "low": round(1 / ratio["high"], 4),
            "base": round(1 / ratio["base"], 4),
            "high": round(1 / ratio["low"], 4),
            "unit": "ratio",
        }
        step.pop("cause")
        if not keep_pos_after:
            step.pop("pos_after")
    for key in ("failure_mix", "by_cause"):
        old["ledger"].pop(key, None)
    return old


@pytest.fixture
def current() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


@pytest.mark.parametrize("keep_pos_after", [True, False])
def test_an_old_report_loads_as_the_current_shape(current: dict, keep_pos_after: bool):
    old = _as_stored_before(current, keep_pos_after=keep_pos_after)
    with pytest.raises(ValueError):
        UnderwritingReport.model_validate(old)
    report = UnderwritingReport.model_validate(upgrade_report(old))
    ledger = report.ledger
    assert ledger and len(ledger.steps) == len(current["ledger"]["steps"])
    # the old chart's posterior stays the posterior, and is the last step's
    assert ledger.posterior == ledger.steps[-1].pos_after
    assert ledger.posterior.base == pytest.approx(current["ledger"]["posterior"]["base"])
    for step in ledger.steps:
        # a ratio that raised the probability is now a risk ratio under 1, and the reverse
        assert (step.risk_ratio.base <= 1) == (step.direction == "up")


def test_the_cause_comes_from_the_factor_and_falls_back_to_other(current: dict):
    old = _as_stored_before(current, keep_pos_after=True)
    old["ledger"]["steps"][0]["factor"] = "Brain toxicity liability"
    old["ledger"]["steps"][1]["factor"] = "Something nobody named"
    steps = upgrade_report(old)["ledger"]["steps"]
    assert steps[0]["cause"] == "safety" and steps[1]["cause"] == "other"


def test_a_current_report_is_left_alone(current: dict):
    assert upgrade_report(current) is current
    assert upgrade_report({"ledger": None}) == {"ledger": None}


def test_an_old_stored_delta_loads_into_the_current_state(current: dict):
    from app.graph.state import load_delta

    old = _as_stored_before(current, keep_pos_after=False)
    state = load_delta({"ledger": old["ledger"]})
    assert state["ledger"].posterior == state["ledger"].steps[-1].pos_after
    assert upgrade_delta({"verdict": {"x": 1}}) == {"verdict": {"x": 1}}
