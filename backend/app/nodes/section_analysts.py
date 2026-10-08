from typing import Any

from app.contracts import KeyPoint, NodeSpec
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.nodes._fixture import excluded_ids, fixture_report, nap, touch_llm
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="section_analysts",
    label="Section analysts",
    kind="analysis",
    phase="analyse",
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
    fixture = fixture_report()
    valid = set(state.get("evidence_ids", [])) - excluded_ids(state)
    own = gate_claims(
        (c for c in fixture.claims.values() if c.produced_by == "section_analysts"), valid
    )
    usable = {i for i, c in {**state.get("claims", {}), **own}.items() if c.status != "rejected"}

    sections = {}
    for section_id, base in fixture.sections.items():
        ctx.progress(f"writing {section_id}")
        result = await touch_llm(ctx, f"section_analysts.{section_id}")
        await nap(f"{ctx.node_id}.{section_id}", 0.15)
        points = [
            KeyPoint(text=kp.text, claim_ids=[c for c in kp.claim_ids if c in usable])
            for kp in base.key_points
        ]
        points = [p for p in points if p.claim_ids]
        status = base.status
        unknowns = list(base.unknowns)
        if not points:
            status = "insufficient_evidence"
            unknowns.append("FIXTURE: no supporting claim survived the evidence gate")
        elif len(points) < len(base.key_points) and base.status == "ok":
            status = "partial"
        sections[section_id] = base.model_copy(
            update={
                "key_points": points,
                "status": status,
                "unknowns": unknowns,
                "panel": result.panel if result else None,
            }
        )

    chain = [
        link.model_copy(
            update={
                "claim_ids": [c for c in link.claim_ids if c in usable],
                "status": "missing"
                if link.claim_ids and not any(c in usable for c in link.claim_ids)
                else link.status,
            }
        )
        for link in fixture.translation_chain
    ]
    risks = [
        r.model_copy(update={"claim_ids": [c for c in r.claim_ids if c in usable]})
        for r in fixture.key_risks
    ]
    questions = [
        q.model_copy(update={"claim_ids": [c for c in q.claim_ids if c in usable]})
        for q in fixture.diligence_questions
    ]
    ctx.log(f"wrote {len(sections)} sections, {len(own)} new claims")
    return {
        "sections": sections,
        "claims": own,
        "translation_chain": chain,
        "key_risks": [r for r in risks if r.claim_ids],
        "critical_unknowns": fixture.critical_unknowns,
        "diligence_questions": questions,
    }
