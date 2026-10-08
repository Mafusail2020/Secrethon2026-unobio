"""The evidence ledger's arithmetic, as pure functions (reference implementation).

A program's failure probability is split by cause (the failure mix); evidence then multiplies one
cause's hazard at a time. With H = -ln(prior): cause i starts at H_i = share_i * H, each adjustment
multiplies it by its risk ratio, and the probability of success is exp(-sum of the H_i). Nothing
here calls a model.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from math import exp, log

from app.contracts import FAILURE_CAUSES, CauseOutcome, FailureMix, Range, RiskAdjustment

EPS = 1e-6
UNIT = "probability"


@dataclass(frozen=True)
class LedgerMath:
    posterior: Range
    after_each: list[Range]
    by_cause: list[CauseOutcome]


def _hazard(p: float) -> float:
    return -log(min(max(p, EPS), 1 - EPS))


def _shares(mix: FailureMix) -> dict[str, float]:
    base = {s.cause: s.share.base for s in mix.shares}
    total = sum(base.values()) or 1.0
    return {c: base.get(c, 0.0) / total for c in FAILURE_CAUSES}


def _product(values: Sequence[float]) -> float:
    out = 1.0
    for v in values:
        out *= v
    return out


def apply_adjustments(
    prior: Range,
    mix: FailureMix,
    adjustments: Sequence[RiskAdjustment],
    clamp: tuple[float, float] = (0.01, 0.95),
) -> LedgerMath:
    """Posterior, the probability after each adjustment, and the outcome per cause.

    The low end of a probability range is the pessimistic one (lower prior, higher risk ratios).
    Hazards and ratios run the other way: their low end is the smaller number."""
    shares = _shares(mix)
    # (prior end, ratio end) for the pessimistic, central and optimistic reading
    ends = (("low", "high"), ("base", "base"), ("high", "low"))

    def pos(prior_end: str, ratio_end: str, upto: int) -> float:
        h0 = _hazard(getattr(prior, prior_end))
        total = 0.0
        for cause in FAILURE_CAUSES:
            ratios = [
                getattr(a.risk_ratio, ratio_end) for a in adjustments[:upto] if a.cause == cause
            ]
            total += shares[cause] * h0 * _product(ratios)
        return min(max(exp(-total), clamp[0]), clamp[1])

    def as_range(upto: int) -> Range:
        low, base, high = (round(pos(p, r, upto), 4) for p, r in ends)
        return Range(low=low, base=base, high=high, unit=UNIT)

    by_cause: list[CauseOutcome] = []
    for cause in FAILURE_CAUSES:
        mine = [a for a in adjustments if a.cause == cause]
        net = Range(
            low=_product([a.risk_ratio.low for a in mine]),
            base=_product([a.risk_ratio.base for a in mine]),
            high=_product([a.risk_ratio.high for a in mine]),
        )
        prior_h = {
            end: shares[cause] * _hazard(getattr(prior, end)) for end in ("low", "base", "high")
        }
        # a smaller hazard is the optimistic one, so low and high swap places
        hazard_prior = Range(low=prior_h["high"], base=prior_h["base"], high=prior_h["low"])
        hazard_posterior = Range(
            low=prior_h["high"] * net.low,
            base=prior_h["base"] * net.base,
            high=prior_h["low"] * net.high,
        )
        share = next(
            (s.share for s in mix.shares if s.cause == cause), Range(low=0, base=0, high=0)
        )
        by_cause.append(
            CauseOutcome(
                cause=cause,  # type: ignore[arg-type]
                share=share,
                hazard_prior=hazard_prior,
                hazard_posterior=hazard_posterior,
                risk_ratio=net,
            )
        )
    return LedgerMath(
        posterior=as_range(len(adjustments)),
        after_each=[as_range(i + 1) for i in range(len(adjustments))],
        by_cause=by_cause,
    )
