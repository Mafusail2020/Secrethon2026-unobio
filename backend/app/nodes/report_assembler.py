from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="report_assembler",
    label="Report assembler",
    kind="output",
    description="Assembles the underwriting report with its claims, evidence and sources.",
    reads=[
        "program",
        "entities",
        "sections",
        "claims",
        "twin_stats",
        "translation_chain",
        "key_risks",
        "critical_unknowns",
        "diligence_questions",
        "ledger",
        "valuation",
        "verdict",
        "evidence_ids",
        "source_ids",
    ],
    writes=["report"],
    correctable=False,
    critical=True,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
