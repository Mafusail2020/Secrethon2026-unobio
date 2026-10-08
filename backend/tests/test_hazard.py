from math import exp, log

import pytest

from app.contracts import CauseShare, FailureMix, Range, RiskAdjustment
from app.quant.hazard import apply_adjustments


def r(low: float, base: float, high: float, unit: str = "ratio") -> Range:
    return Range(low=low, base=base, high=high, unit=unit)


def mix(**shares: float) -> FailureMix:
    return FailureMix(
        shares=[CauseShare(cause=c, share=r(s, s, s, "share")) for c, s in shares.items()],  # type: ignore[arg-type]
        source="literature",
        basis="assumption",
    )


def adj(cause: str, ratio: tuple[float, float, float], factor: str = "f") -> RiskAdjustment:
    return RiskAdjustment(cause=cause, factor=factor, risk_ratio=r(*ratio), basis="assumption")  # type: ignore[arg-type]


PRIOR = r(0.05, 0.10, 0.20, "probability")
MIX = mix(efficacy=0.5, safety=0.3, pk_exposure=0.1, commercial=0.1)


def test_no_adjustments_returns_the_prior_and_splits_its_hazard_by_share():
    out = apply_adjustments(PRIOR, MIX, [])
    assert out.posterior == PRIOR and out.after_each == []
    total = sum(c.hazard_prior.base for c in out.by_cause)
    assert total == pytest.approx(-log(0.10))
    efficacy = next(c for c in out.by_cause if c.cause == "efficacy")
    assert efficacy.hazard_prior.base == pytest.approx(0.5 * -log(0.10))
    assert all(c.hazard_prior == c.hazard_posterior for c in out.by_cause)


def test_the_arithmetic_matches_a_hand_calculation():
    # H = 2.3026; efficacy gets 1.1513 and is halved, everything else is untouched
    out = apply_adjustments(PRIOR, MIX, [adj("efficacy", (0.5, 0.5, 0.5))])
    assert out.posterior.base == pytest.approx(exp(-(0.5 * 0.5 + 0.5) * -log(0.10)), abs=1e-4)
    assert out.posterior.base > 0.10


def test_an_adjustment_moves_only_its_own_cause():
    out = apply_adjustments(PRIOR, MIX, [adj("safety", (1.5, 1.5, 1.5))])
    by = {c.cause: c for c in out.by_cause}
    assert by["safety"].hazard_posterior.base == pytest.approx(1.5 * by["safety"].hazard_prior.base)
    for other in ("efficacy", "pk_exposure", "commercial"):
        assert by[other].hazard_posterior == by[other].hazard_prior
    assert out.posterior.base < 0.10


def test_the_final_probability_does_not_depend_on_the_order_of_adjustments():
    a, b, c = (
        adj("efficacy", (0.8, 0.9, 1.0), "a"),
        adj("safety", (1.1, 1.3, 1.5), "b"),
        adj("efficacy", (1.0, 1.2, 1.4), "c"),
    )
    forward = apply_adjustments(PRIOR, MIX, [a, b, c])
    backward = apply_adjustments(PRIOR, MIX, [c, b, a])
    assert forward.posterior == backward.posterior
    assert forward.after_each[-1] == forward.posterior


def test_ratios_of_one_change_nothing_and_ranges_stay_ordered():
    out = apply_adjustments(PRIOR, MIX, [adj("efficacy", (1.0, 1.0, 1.0))])
    assert out.posterior == PRIOR
    wide = apply_adjustments(
        PRIOR, MIX, [adj("efficacy", (0.6, 1.1, 1.8)), adj("safety", (0.9, 1.0, 1.6))]
    )
    assert wide.posterior.low <= wide.posterior.base <= wide.posterior.high
    for outcome in wide.by_cause:
        assert (
            outcome.hazard_posterior.low
            <= outcome.hazard_posterior.base
            <= outcome.hazard_posterior.high
        )


def test_the_result_is_clamped_and_survives_extreme_priors():
    hard = apply_adjustments(
        r(0.001, 0.002, 0.004, "probability"), MIX, [adj("efficacy", (5.0, 5.0, 5.0))]
    )
    assert hard.posterior.low >= 0.01
    sure = apply_adjustments(
        r(0.97, 0.98, 0.99, "probability"), MIX, [adj("efficacy", (0.1, 0.1, 0.1))]
    )
    assert sure.posterior.high <= 0.95


def test_shares_within_tolerance_are_normalised_for_the_arithmetic():
    lopsided = mix(efficacy=0.6, safety=0.39)  # the contract allows 0.02 of slack
    out = apply_adjustments(PRIOR, lopsided, [])
    assert sum(c.hazard_prior.base for c in out.by_cause) == pytest.approx(-log(0.10))
