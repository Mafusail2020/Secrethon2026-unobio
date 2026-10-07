from typing import Any

from app.contracts import NodeSpec
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="section_analysts",
    label="Section analysts",
    kind="analysis",
    description="Writes each report section plus the translation chain, risks, unknowns and diligence questions.",
    reads=["program", "entities", "questions", "claims", "twin_stats", "evidence_ids"],
    writes=[
        "sections",
        "claims",
        "translation_chain",
        "key_risks",
        "critical_unknowns",
        "diligence_questions",
    ],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    return {}
