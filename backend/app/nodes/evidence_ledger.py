from typing import Any

from app.contracts import FAILURE_CAUSES, EvidenceLedger, LedgerStep, NodeSpec
from app.graph.state import GraphState
from app.nodes._fixture import fixture_report, nap
from app.nodes.base import NodeContext
from app.quant.hazard import apply_adjustments

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


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    base = fixture_report().ledger
    assert base is not None and base.failure_mix is not None
    twin = state.get("twin_stats")
    prior = twin.prior_pos if twin else base.prior
    mix = (twin.failure_mix if twin else None) or base.failure_mix
    # applied cause by cause, then by name, so the order never depends on which lane finished first
    adjustments = sorted(
        state.get("risk_adjustments", {}).values(),
        key=lambda a: (FAILURE_CAUSES.index(a.cause), a.factor),
    )
    await nap(ctx.node_id)
    math = apply_adjustments(prior, mix, adjustments)
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
        f"{len(steps)} risk adjustments: PoS {prior.base:.3f} -> {ledger.posterior.base:.3f} (FIXTURE ratios)"
    )
    return {"ledger": ledger}
