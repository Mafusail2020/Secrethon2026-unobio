from typing import Any

from app.contracts import NodeSpec, ReasonCode, Verdict
from app.graph.state import GraphState
from app.nodes._fixture import fixture_report, nap
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="verdict",
    label="Verdict",
    kind="quant",
    description="Applies thresholds and reason codes to decide invest, conditional or do not invest.",
    reads=["ledger", "valuation", "claims", "key_risks", "twin_stats"],
    writes=["verdict"],
    correctable=True,
    critical=True,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    base = fixture_report().verdict
    usable = {i for i, c in state.get("claims", {}).items() if c.status != "rejected"}
    reasons = [
        r.model_copy(update={"claim_ids": [c for c in r.claim_ids if c in usable]})
        for r in base.reason_codes
    ]
    await nap(ctx.node_id)
    flips = [c for c in state.get("corrections", []) if "terminated" in c.text.lower()]
    if flips:
        ctx.log(
            "a user correction mentions a terminated program: flipping to do_not_invest", "warn"
        )
        return {
            "verdict": Verdict(
                decision="do_not_invest",
                confidence="medium",
                reason_codes=[
                    *reasons[:4],
                    ReasonCode(
                        code="USER_CORRECTION",
                        text=f"FIXTURE: user correction: {flips[-1].text[:200]}",
                        direction="negative",
                        claim_ids=[],
                    ),
                ],
                conditions=[],
                rationale="FIXTURE: decision changed after a correction about a terminated program",
            )
        }
    ctx.log(f"decision: {base.decision} (FIXTURE)")
    return {"verdict": base.model_copy(update={"reason_codes": reasons})}
