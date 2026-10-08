"""Reports stored before the cause-specific ledger carry the old step shape: read them as the
current one.

Old steps had a `likelihood_ratio` on odds and an optional `pos_after`. Steps now carry a
`cause`, a `risk_ratio` on that cause's hazard (the inverse of the old ratio, since a ratio
above 1 used to raise the probability) and a required `pos_after`, and the posterior must be the
last step's. Nothing is invented: a cause is guessed from the factor's words and falls back to
`other`, and a missing `pos_after` is chained from the prior on odds, as the old chart did.
"""

import copy
from typing import Any

_CAUSE_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("safety", ("safety", "toxic", "liabil", "adverse", "tolerab")),
    ("pk_exposure", ("exposure", "pharmacokin", " pk", "dose", "bioavail")),
    ("commercial", ("commercial", "price", "pricing", "competit", "reimburs", "adoption")),
    ("efficacy", ("efficacy", "biolog", "translation", "twin", "trial", "genetic", "engage")),
)


def _cause(factor: str) -> str:
    text = factor.lower()
    for cause, words in _CAUSE_WORDS:
        if any(w in text for w in words):
            return cause
    return "other"


def _odds_step(p: float, ratio: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    odds = p / (1 - p) * ratio
    return odds / (1 + odds)


def _inverse(r: dict[str, Any]) -> dict[str, Any]:
    low, base, high = (max(r[k], 1e-6) for k in ("low", "base", "high"))
    return {
        "low": round(1 / high, 4),
        "base": round(1 / base, 4),
        "high": round(1 / low, 4),
        "unit": "ratio",
    }


def upgrade_ledger(ledger: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ledger or not any("likelihood_ratio" in s for s in ledger.get("steps", [])):
        return ledger
    out = copy.deepcopy(ledger)
    running = out["prior"]
    for step in out["steps"]:
        lr = step.pop("likelihood_ratio", None)
        if lr is not None:
            step.setdefault("cause", _cause(step.get("factor", "")))
            step.setdefault("risk_ratio", _inverse(lr))
        if not step.get("pos_after") and lr is not None:
            chained = [round(_odds_step(running[k], lr[k]), 4) for k in ("low", "base", "high")]
            low, base, high = sorted(chained)
            step["pos_after"] = {"low": low, "base": base, "high": high, "unit": "probability"}
        running = step.get("pos_after") or running
    if out["steps"]:
        out["steps"][-1]["pos_after"] = out["posterior"]
    return out


def upgrade_report(raw: dict[str, Any]) -> dict[str, Any]:
    ledger = upgrade_ledger(raw.get("ledger"))
    return raw if ledger is raw.get("ledger") else {**raw, "ledger": ledger}


def upgrade_delta(delta: dict[str, Any]) -> dict[str, Any]:
    """A stored node delta, as the current state expects it."""
    out = dict(delta)
    if "ledger" in out:
        out["ledger"] = upgrade_ledger(out["ledger"])
    if isinstance(out.get("report"), dict):
        out["report"] = upgrade_report(out["report"])
    return out
