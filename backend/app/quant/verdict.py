"""Deterministic decision rules. No model call: the same inputs always give the same verdict."""

import re
from dataclasses import dataclass, field
from typing import Any

from app.contracts import (
    AssessmentResult,
    Claim,
    Correction,
    EvidenceLedger,
    ReasonCode,
    Risk,
    TwinStats,
    Valuation,
    Verdict,
)
from app.contracts.common import Confidence, Decision

LATE = {"PHASE_2_3", "PHASE_3", "PREAPPROVAL", "APPROVAL", "PHASE_4"}
MAX_REASONS = 5


@dataclass
class Inputs:
    ledger: EvidenceLedger | None
    valuation: Valuation | None
    twin: TwinStats | None
    claims: dict[str, Claim]
    key_risks: list[Risk]
    assessments: dict[str, AssessmentResult]
    corrections: list[Correction] = field(default_factory=list)


def _usable(claims: dict[str, Claim], ids: list[str]) -> list[str]:
    return [i for i in ids if i in claims and claims[i].status != "rejected"]


def efficacy_failures(twin: TwinStats | None) -> int:
    """Late-stage same-indication twins stopped for lack of efficacy."""
    if twin is None or twin.match_level != "exact_target_indication":
        return 0
    efficacy_classes = sum(
        n for c, n in twin.stop_reasons.items() if twin.stop_reason_categories.get(c) == "efficacy"
    )
    late_stopped = sum(t.status == "stopped" and t.max_stage in LATE for t in twin.twins)
    return min(efficacy_classes, late_stopped)


def decide(inputs: Inputs, conf: dict[str, Any]) -> Verdict:
    th = {k: v["value"] for k, v in conf["thresholds"].items()}
    reasons: list[ReasonCode] = []
    conditions: list[str] = []
    pos = (
        inputs.ledger.posterior
        if inputs.ledger
        else (inputs.twin.prior_pos if inputs.twin else None)
    )
    rnpv = inputs.valuation.rnpv if inputs.valuation else None

    kill: list[str] = []
    failures = efficacy_failures(inputs.twin)
    if failures >= th["kill_min_efficacy_failures"]:
        kill.append("TWIN_EFFICACY_FAILURES")
        reasons.append(
            ReasonCode(
                code="TWIN_EFFICACY_FAILURES",
                text=(
                    f"{failures} late-stage programs on the same target in the same indication "
                    "were stopped for lack of efficacy"
                ),
                direction="negative",
                cause="efficacy",
            )
        )

    failure_words = re.compile(rf"\b({conf['corrections']['failure_words']})\b", re.I)
    reported = [c for c in inputs.corrections if failure_words.search(c.text)]
    if reported:
        kill.append("USER_REPORTED_FAILURE")
        reasons.append(
            ReasonCode(
                code="USER_REPORTED_FAILURE",
                text=f"user correction reports a failure: {reported[-1].text[:200]}",
                direction="negative",
            )
        )

    if inputs.twin is not None:
        decided = [t for t in inputs.twin.twins if t.status in ("approved", "stopped")]
        approved = sum(t.status == "approved" for t in decided)
        if decided:
            rate = approved / len(decided)
            reasons.append(
                ReasonCode(
                    code="TWIN_TRACK_RECORD",
                    text=(
                        f"{approved} of {len(decided)} comparable programs "
                        f"({inputs.twin.match_level.replace('_', ' ')}) reached approval"
                    ),
                    direction="positive" if rate >= 0.5 else "negative",
                    cause="efficacy" if rate < 0.5 else None,
                )
            )

    for _, result in sorted(inputs.assessments.items()):
        if result.rating in ("strong", "concerning"):
            reasons.append(
                ReasonCode(
                    code=f"{result.cause.upper()}_{result.rating.upper()}",
                    text=result.headline,
                    direction="positive" if result.rating == "strong" else "negative",
                    cause=result.cause,
                    claim_ids=_usable(inputs.claims, result.claim_ids),
                )
            )
        conditions += [f"Resolve: {g}" for g in result.gaps[:2]]

    high_risks = [r for r in inputs.key_risks if r.severity == "high"]
    for risk in high_risks[:1]:
        reasons.append(
            ReasonCode(
                code=f"RISK_{risk.category.upper()}",
                text=risk.text,
                direction="negative",
                cause=risk.category
                if risk.category in ("efficacy", "safety", "pk_exposure", "commercial")
                else None,  # type: ignore[arg-type]
                claim_ids=_usable(inputs.claims, risk.claim_ids),
            )
        )
    conditions = [f"Address: {r.text}" for r in high_risks[:3]] + conditions

    if pos is not None:
        reasons.append(
            ReasonCode(
                code="POSTERIOR_POS",
                text=(
                    f"probability of success {pos.base:.1%} (range {pos.low:.1%}–{pos.high:.1%}); "
                    f"invest needs at least {th['invest_min_pos_low']:.0%} at the pessimistic end"
                ),
                direction="positive" if pos.low >= th["invest_min_pos_low"] else "negative",
            )
        )
    if rnpv is not None:
        reasons.append(
            ReasonCode(
                code="RNPV",
                text=(f"risk-adjusted NPV {usd(rnpv.base)} ({usd(rnpv.low)} to {usd(rnpv.high)})"),
                direction="positive" if rnpv.base > 0 else "negative",
                cause="commercial",
            )
        )

    red_flags = kill or [r for r in reasons if r.code.endswith("_CONCERNING")] or high_risks
    decision: Decision
    if kill or (rnpv is not None and rnpv.high < 0):
        decision = "do_not_invest"
    elif (
        pos is not None
        and pos.low >= th["invest_min_pos_low"]
        and rnpv is not None
        and rnpv.low > 0
        and not red_flags
    ):
        decision = "invest"
    else:
        decision = "conditional"
        if rnpv is not None and rnpv.low <= 0 < rnpv.high:
            conditions.append(
                "The rNPV range spans zero: tighten trial size, cost and peak-sales assumptions"
            )
        if pos is not None and pos.low < th["invest_min_pos_low"]:
            conditions.append(
                "Raise confidence in efficacy before the next milestone (human genetics, "
                "target engagement or a differentiating biomarker)"
            )

    confidence = _confidence(pos, inputs.twin, th, kill, failures)
    order = {"TWIN_EFFICACY_FAILURES": 0, "USER_REPORTED_FAILURE": 0, "POSTERIOR_POS": 2, "RNPV": 3}
    reasons = sorted(reasons, key=lambda r: order.get(r.code, 1))[:MAX_REASONS]
    rationale = _rationale(decision, kill, pos, rnpv)
    return Verdict(
        decision=decision,
        confidence=confidence,
        reason_codes=reasons,
        conditions=list(dict.fromkeys(conditions))[:5] if decision == "conditional" else [],
        rationale=rationale,
    )


def usd(value: float) -> str:
    return f"{'-' if value < 0 else ''}${abs(value) / 1e6:,.0f}M"


def _confidence(
    pos, twin: TwinStats | None, th: dict[str, float], kill: list[str], failures: int
) -> Confidence:
    # a kill flag rests on programs that already failed, not on the width of the PoS range
    if "TWIN_EFFICACY_FAILURES" in kill:
        return "high" if failures > th["kill_min_efficacy_failures"] else "medium"
    if kill:
        return "medium"
    decided = sum(t.status in ("approved", "stopped") for t in twin.twins) if twin else 0
    if pos is None or decided < th["min_decided_twins_for_confidence"]:
        return "low"
    ratio = pos.high / max(pos.low, 1e-4)
    if ratio > th["low_confidence_ratio"] or (twin and twin.match_level == "area_base_rate"):
        return "low"
    return "high" if ratio <= th["high_confidence_ratio"] else "medium"


def _rationale(decision: Decision, kill: list[str], pos, rnpv) -> str:
    parts = []
    if kill:
        parts.append("kill flag: " + ", ".join(k.lower().replace("_", " ") for k in kill))
    if pos is not None:
        parts.append(f"PoS {pos.base:.1%} ({pos.low:.1%}–{pos.high:.1%})")
    if rnpv is not None:
        parts.append(f"rNPV {usd(rnpv.low)} to {usd(rnpv.high)}")
    head = {
        "invest": "Invest",
        "conditional": "Conditional",
        "do_not_invest": "Do not invest",
    }[decision]
    return f"{head}: " + "; ".join(parts) + "."
