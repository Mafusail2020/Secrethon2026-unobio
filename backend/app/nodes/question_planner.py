from typing import Any

from pydantic import Field

from app.contracts import SECTION_IDS, NodeSpec, PlannedQuestion, SectionId
from app.graph.state import GraphState
from app.nodes._analysis import (
    Draft,
    ask,
    describe_program,
    fixture_run,
    instructions,
    system_prompt,
)
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
MAX_QUESTIONS = 16
MAX_PER_SECTION = 3

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


class _Question(Draft):
    section: SectionId
    question: str
    rationale: str
    priority: int = Field(ge=1)


class QuestionPlan(Draft):
    questions: list[_Question] = Field(default_factory=list)


def plan_questions(
    drafted: list[_Question], indication: str, mechanism: str
) -> tuple[list[PlannedQuestion], list[str]]:
    """Model questions by priority, at most a few per section; a section it skipped gets a default."""
    per_section: dict[str, list[_Question]] = {}
    for q in sorted(drafted, key=lambda q: q.priority):
        text = " ".join(q.question.split())
        if text and len(per_section.setdefault(q.section, [])) < MAX_PER_SECTION:
            per_section[q.section].append(q.model_copy(update={"question": text}))
    defaulted = [s for s in SECTION_IDS if not per_section.get(s)]
    picked = [q for qs in per_section.values() for q in qs]
    picked = sorted(picked, key=lambda q: q.priority)[: MAX_QUESTIONS - len(defaulted)]
    out: list[tuple[int, PlannedQuestion]] = []
    seen: dict[str, int] = {}
    for q in picked:
        seen[q.section] = seen.get(q.section, 0) + 1
        n = seen[q.section]
        out.append(
            (
                q.priority,
                PlannedQuestion(
                    id=f"q_{q.section}" + (f"_{n}" if n > 1 else ""),
                    section=q.section,
                    question=q.question,
                    rationale=" ".join(q.rationale.split()),
                    priority=q.priority,
                ),
            )
        )
    lowest = max((p for p, _ in out), default=0)
    for i, section in enumerate(defaulted, 1):
        out.append(
            (
                lowest + i,
                PlannedQuestion(
                    id=f"q_{section}",
                    section=section,  # type: ignore[arg-type]
                    question=_ASKS[section].format(indication=indication, mechanism=mechanism),
                    rationale="standard question for this section; the planner did not ask one",
                    priority=lowest + i,
                ),
            )
        )
    ranked = [q for _, q in sorted(out, key=lambda pq: pq[0])]
    return [q.model_copy(update={"priority": i}) for i, q in enumerate(ranked, 1)], defaulted


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    if fixture_run(state):
        return await _fixture_run(state, ctx)
    program = state["program"]
    ctx.log("planning which questions matter for this program")
    user = describe_program(state)
    if extra := instructions(ctx):
        user += f"\n\n{extra}"
    plan = await ask(
        ctx,
        "question_planner.plan",
        system_prompt("question_planner"),
        user,
        QuestionPlan,
        max_tokens=1500,
    )
    questions, defaulted = plan_questions(
        plan.questions if plan else [], program.indication, program.mechanism
    )
    if defaulted:
        ctx.log(f"standard questions for sections the planner skipped: {', '.join(defaulted)}")
    for q in questions[:5]:
        ctx.log(f"{q.priority}. [{q.section}] {q.question}")
    ctx.log(f"planned {len(questions)} questions")
    return {"questions": questions}


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
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
