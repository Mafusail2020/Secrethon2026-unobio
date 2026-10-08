from typing import Any

from app.contracts import EvidenceLedger, LedgerStep, NodeSpec, Range
from app.graph.state import GraphState
from app.nodes._fixture import excluded_ids, fixture_report, nap
from app.nodes.base import NodeContext


def _chain(prior: Range, steps: list[LedgerStep]) -> list[LedgerStep]:
    """Fill pos_after on each step by chaining likelihood ratios from the prior (odds form)."""

    def apply(p: float, ratio: float) -> float:
        p = min(max(p, 0.0), 1 - 1e-9)
        odds = p / (1 - p) * ratio
        return odds / (1 + odds)

    current = (prior.low, prior.base, prior.high)
    chained: list[LedgerStep] = []
    for step in steps:
        lr = step.likelihood_ratio
        current = (
            apply(current[0], lr.low),
            apply(current[1], lr.base),
            apply(current[2], lr.high),
        )
        pos = Range(
            low=round(current[0], 4),
            base=round(current[1], 4),
            high=round(current[2], 4),
            unit="probability",
        )
        chained.append(step.model_copy(update={"pos_after": pos}))
    return chained


SPEC = NodeSpec(
    id="evidence_ledger",
    label="Evidence ledger",
    kind="quant",
    phase="quant",
    description="Combines the twin prior with likelihood ratios from evidence into a posterior range.",
    reads=["twin_stats", "claims", "sections", "evidence_ids"],
    writes=["ledger"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    base = fixture_report().ledger
    assert base is not None
    twin = state.get("twin_stats")
    prior = twin.prior_pos if twin else base.prior
    usable = {i for i, c in state.get("claims", {}).items() if c.status != "rejected"}
    valid_evidence = set(state.get("evidence_ids", [])) - excluded_ids(state)
    await nap(ctx.node_id)
    steps = [
        s.model_copy(
            update={
                "claim_ids": [c for c in s.claim_ids if c in usable],
                "evidence_ids": [e for e in s.evidence_ids if e in valid_evidence],
            }
        )
        for s in base.steps
        if not s.claim_ids or any(c in usable for c in s.claim_ids)
    ]
    steps = _chain(prior, steps)
    posterior = steps[-1].pos_after if steps and steps[-1].pos_after else prior
    ledger = EvidenceLedger(prior=prior, steps=steps, posterior=posterior)
    ctx.log(
        f"{len(steps)} ledger steps: PoS {prior.base:.3f} -> {ledger.posterior.base:.3f} (FIXTURE ratios)"
    )
    return {"ledger": ledger}
