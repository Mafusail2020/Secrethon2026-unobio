import re
from typing import Any

import yaml

from app.contracts import (
    FAILURE_CAUSES,
    CauseShare,
    EvidenceLedger,
    FailureMix,
    LedgerStep,
    NodeSpec,
    Range,
    RiskAdjustment,
)
from app.core.settings import get_settings
from app.graph.state import GraphState
from app.nodes.base import NodeContext
from app.quant.base_rates import config as base_rate_config
from app.quant.hazard import apply_adjustments
from app.quant.twin_stats import beta_range

SPEC = NodeSpec(
    id="evidence_ledger",
    label="Evidence ledger",
    kind="quant",
    phase="quant",
    description="Splits the prior's failure risk by cause, applies the lanes' risk adjustments to each cause and gives the posterior range.",
    reads=["twin_stats", "risk_adjustments", "claims", "sections", "evidence_ids"],
    writes=["ledger"],
    correctable=True,
    critical=False,
)

DROP_WORDS = re.compile(r"\b(exclude|ignore|remove|drop|without)\b", re.I)


def _literature_mix(conf: dict[str, Any]) -> FailureMix:
    literature = conf["failure_mix"]["literature"]
    return FailureMix(
        shares=[
            CauseShare(cause=c, share=Range(**v, unit="share"))
            for c, v in literature["shares"].items()
        ],
        source="literature",
        basis="sourced",
        citation=" ".join(literature["citation"].split()),
    )


def _fallback_prior(conf: dict[str, Any]) -> Range:
    if conf.get("prior_fallback"):
        return Range(**conf["prior_fallback"], unit="probability")
    rates = base_rate_config()["areas"]["all"]
    loa = rates["p1"] * rates["p2"] * rates["p3"] * rates["nda"]
    return beta_range(0, 0, loa)


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    conf = yaml.safe_load((get_settings().config_dir / "ledger.yaml").read_text())
    twin = state.get("twin_stats")
    if twin is not None:
        prior = twin.prior_pos
    else:
        prior = _fallback_prior(conf)
        ctx.log("no twin stats: prior is the all-indications base rate", "warn")
    mix = (twin.failure_mix if twin else None) or _literature_mix(conf)
    clamp = conf.get("posterior_clamp") or {"low": 0.01, "high": 0.95}

    # applied cause by cause, then by name, so the order never depends on which lane finished first
    adjustments: list[RiskAdjustment] = sorted(
        state.get("risk_adjustments", {}).values(),
        key=lambda a: (FAILURE_CAUSES.index(a.cause), a.factor),
    )
    if twin is not None and twin.match_level == "exact_target_indication":
        # the prior already counts those failures; applying them again would double count
        doubled = [
            a for a in adjustments if a.cause == "efficacy" and "terminat" in a.factor.lower()
        ]
        for a in doubled:
            ctx.log(f"skipped '{a.factor}': the prior already comes from same-indication twins")
        adjustments = [a for a in adjustments if a not in doubled]

    drop_texts = [_key(c.text) for c in ctx.corrections_for() if DROP_WORDS.search(c.text)]
    if drop_texts:
        dropped = [a for a in adjustments if any(_key(a.factor) in t for t in drop_texts)]
        for a in dropped:
            ctx.log(f"removed '{a.factor}' as a correction asked")
        adjustments = [a for a in adjustments if a not in dropped]

    math = apply_adjustments(prior, mix, adjustments, clamp=(clamp["low"], clamp["high"]))
    steps = [
        LedgerStep(
            factor=a.factor,
            cause=a.cause,
            direction="up" if a.risk_ratio.base <= 1 else "down",
            risk_ratio=a.risk_ratio,
            basis=a.basis,
            citation=a.citation,
            claim_ids=a.claim_ids,
            evidence_ids=a.evidence_ids,
            pos_after=pos,
        )
        for a, pos in zip(adjustments, math.after_each, strict=True)
    ]
    ledger = EvidenceLedger(
        prior=prior, failure_mix=mix, steps=steps, by_cause=math.by_cause, posterior=math.posterior
    )
    ctx.log(
        f"{len(steps)} risk adjustment(s), failure mix from {mix.source}: PoS {prior.base:.3f} "
        f"-> {ledger.posterior.base:.3f} ({ledger.posterior.low:.3f}–{ledger.posterior.high:.3f})"
    )
    return {"ledger": ledger}
