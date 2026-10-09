"""The numbers a deck may quote, written as the deck writes them, and the check that a
sentence holds no number the report does not."""

import re

from app.contracts import Range, UnderwritingReport

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
SMALL_COUNT = 12  # "two trials", "5 steps": counts need no source


def pct(x: float) -> str:
    return f"{x * 100:.{1 if x < 0.1 else 0}f}%"


def usd(x: float) -> str:
    sign, x = ("-", -x) if x < 0 else ("", x)
    for size, unit, digits in ((1e9, "B", 1), (1e6, "M", 1), (1e3, "K", 0)):
        if x >= size:
            return f"{sign}${x / size:.{digits}f}{unit}"
    return f"{sign}${x:.0f}"


def _range(r: Range, fmt) -> str:
    return f"{fmt(r.base)} (range {fmt(r.low)} to {fmt(r.high)})"


def numbers_block(report: UnderwritingReport) -> str:
    """Every figure a slide may need, pre-formatted. The model copies from here, never computes."""
    lines = ["NUMBERS (copy numbers from here; never compute or round them yourself)"]
    lines.append(f"PROBABILITY OF SUCCESS: {_range(report.pos, pct)}")
    ledger = report.ledger
    if ledger:
        lines.append(f"PRIOR (before the evidence): {_range(ledger.prior, pct)}")
        before = ledger.prior.base
        steps = []
        for step in ledger.steps:
            points = (step.pos_after.base - before) * 100
            before = step.pos_after.base
            steps.append(f"{step.factor} [{step.cause}]: {points:+.1f} points")
        if steps:
            lines.append(
                "STEP POINTS (each piece of evidence moved the chance by): " + "; ".join(steps)
            )
    if report.twin_stats:
        t = report.twin_stats
        lines.append(
            f"SIMILAR PROGRAMS: {t.n_programs} matched on {t.match_level.replace('_', ' ')}; "
            f"starting chance {_range(t.prior_pos, pct)}"
        )
    if report.valuation:
        v = report.valuation
        months = v.time_to_milestone_months
        lines.append(
            f"FUNDING: next milestone {v.next_milestone}; "
            f"capital needed {_range(v.capital_to_milestone, usd)}; "
            f"time {months.base:.0f} months (range {months.low:.0f} to {months.high:.0f}); "
            f"risk-adjusted value {_range(v.rnpv, usd)}"
        )
    counted = [c for c in report.claims.values() if c.status != "rejected"]
    if counted:
        grounded = sum(c.label in ("extracted", "derived") for c in counted)
        by_label = ", ".join(
            f"{label} {sum(c.label == label for c in counted)}"
            for label in ("extracted", "derived", "inferred", "modeled", "hypothesis", "unknown")
            if any(c.label == label for c in counted)
        )
        lines.append(
            f"CLAIMS: {len(counted)} counted, {pct(grounded / len(counted))} grounded "
            f"(extracted or derived); by label: {by_label}"
        )
    lines.append(f"SOURCES: {len(report.sources)} sources, {len(report.evidence)} evidence items")
    return "\n".join(lines) + "\n"


def _tokens(text: str) -> set[str]:
    return {t.replace(",", "").rstrip(".") for t in _NUMBER.findall(text)}


def number_checker(*texts: str):
    """Says whether a sentence uses only numbers found in `texts` (or small counts)."""
    allowed = set().union(*(_tokens(t) for t in texts))

    def ok(sentence: str) -> bool:
        for token in _tokens(sentence):
            if token in allowed:
                continue
            if token.isdigit() and int(token) <= SMALL_COUNT:
                continue
            return False
        return True

    return ok
