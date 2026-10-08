from typing import Any

import yaml

from app.contracts import NodeSpec
from app.core.settings import get_settings
from app.graph.state import GraphState
from app.nodes.base import NodeContext
from app.quant.verdict import Inputs, decide

SPEC = NodeSpec(
    id="verdict",
    label="Verdict",
    kind="quant",
    phase="quant",
    description="Applies thresholds and reason codes to decide invest, conditional or do not invest.",
    reads=["ledger", "valuation", "claims", "key_risks", "twin_stats", "assessments"],
    writes=["verdict"],
    correctable=True,
    critical=True,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    conf = yaml.safe_load((get_settings().config_dir / "verdict.yaml").read_text())
    corrections = ctx.corrections_for()
    verdict = decide(
        Inputs(
            ledger=state.get("ledger"),
            valuation=state.get("valuation"),
            twin=state.get("twin_stats"),
            claims=state.get("claims", {}),
            key_risks=state.get("key_risks", []),
            assessments=state.get("assessments", {}),
            corrections=corrections,
        ),
        conf,
    )
    if corrections and not any(r.code == "USER_REPORTED_FAILURE" for r in verdict.reason_codes):
        ctx.log("correction recorded; it reports no failure, so the rules give the same decision")
    for reason in verdict.reason_codes:
        ctx.log(f"{reason.code} ({reason.direction}): {reason.text}")
    ctx.log(f"decision: {verdict.decision} (confidence {verdict.confidence})")
    return {"verdict": verdict}
