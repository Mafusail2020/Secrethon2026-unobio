from typing import Any

from app.contracts import EvidenceLedger, LedgerStep, NodeSpec, Range
from app.graph.state import GraphState
from app.nodes._fixture import excluded_ids, fixture_report, nap
from app.nodes.base import NodeContext


def _posterior(prior: Range, steps: list[LedgerStep]) -> Range:
    def apply(p: float, ratios: list[float]) -> float:
        p = min(max(p, 0.0), 1 - 1e-9)
        odds = p / (1 - p)
        for ratio in ratios:
            odds *= ratio
        return round(odds / (1 + odds), 4)

    return Range(
        low=apply(prior.low, [s.likelihood_ratio.low for s in steps]),
        base=apply(prior.base, [s.likelihood_ratio.base for s in steps]),
        high=apply(prior.high, [s.likelihood_ratio.high for s in steps]),
        unit="probability",
    )


SPEC = NodeSpec(
    id="evidence_ledger",
    label="Evidence ledger",
    kind="quant",
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
    ledger = EvidenceLedger(prior=prior, steps=steps, posterior=_posterior(prior, steps))
    ctx.log(
        f"{len(steps)} ledger steps: PoS {prior.base:.3f} -> {ledger.posterior.base:.3f} (FIXTURE ratios)"
    )
    return {"ledger": ledger}
