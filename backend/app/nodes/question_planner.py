from typing import Any

from app.contracts import SECTION_IDS, NodeSpec, PlannedQuestion
from app.graph.state import GraphState
from app.nodes._fixture import nap, touch_llm
from app.nodes.base import NodeContext

_ASKS = {
    "disease_need": "how large is the unmet need in {indication}?",
    "scientific_thesis": "what evidence links {mechanism} to {indication}?",
    "translation": "does {mechanism} engagement lead to patient benefit in humans?",
    "clinical_plan": "how did earlier programs on {mechanism} fare in trials?",
    "competition": "what standard of care and competitors must this beat?",
    "commercial_adoption": "would prescribers and payers adopt it?",
    "capital": "what does it cost to reach the next milestone?",
    "safety": "which toxicities and side effects of {mechanism} could stop it in people?",
    "risks": "which regulatory, CMC and IP risks could stop it?",
}

SPEC = NodeSpec(
    id="question_planner",
    label="Question planner",
    kind="analysis",
    phase="plan",
    description="Decides which diligence questions matter for this specific program.",
    reads=["program", "entities"],
    writes=["questions"],
    correctable=True,
    critical=False,
)


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program = state["program"]
    ctx.log("planning which questions matter for this program")
    await touch_llm(ctx, "question_planner.plan")
    await nap(ctx.node_id)
    questions = [
        PlannedQuestion(
            id=f"q_{section}",
            section=section,  # type: ignore[arg-type]
            question="FIXTURE: "
            + _ASKS[section].format(indication=program.indication, mechanism=program.mechanism),
            rationale="FIXTURE: placeholder rationale",
            priority=priority,
        )
        for priority, section in enumerate(SECTION_IDS, 1)
    ]
    ctx.log(f"planned {len(questions)} questions")
    return {"questions": questions}
