from typing import Any

from app.contracts import NodeSpec, RunMeta, UnderwritingReport, utcnow
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.nodes.base import NodeContext

SPEC = NodeSpec(
    id="report_assembler",
    label="Report assembler",
    kind="output",
    phase="report",
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
        "assessments",
        "valuation",
        "verdict",
        "evidence_ids",
        "source_ids",
    ],
    writes=["report"],
    correctable=False,
    critical=True,
)

_FIXTURE_MARK = "FIXTURE:"


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    program, entities, verdict = state.get("program"), state.get("entities"), state.get("verdict")
    if program is None or entities is None or verdict is None:
        raise ValueError("cannot assemble a report without program, entities and verdict")

    ledger, twin = state.get("ledger"), state.get("twin_stats")
    pos = ledger.posterior if ledger else (twin.prior_pos if twin else None)
    if pos is None:
        raise ValueError("cannot assemble a report without a ledger or twin prior")

    cited = list(state.get("claims", {}).values())
    assessments = sorted(state.get("assessments", {}).values(), key=lambda a: a.cause)
    # the run's own evidence set; evidence the user excluded must not reappear via rejected claims
    excluded = {i for c in state.get("corrections", []) for i in c.exclude_evidence_ids}
    in_run = set(state.get("evidence_ids", [])) - excluded
    wanted = list(
        dict.fromkeys(
            i
            for i in [
                *(i for c in cited for i in c.evidence_ids),
                *(i for step in (ledger.steps if ledger else []) for i in step.evidence_ids),
                *(i for a in assessments for m in a.metrics for i in m.evidence_ids),
            ]
            if i in in_run
        )
    )
    evidence = {e.id: e for e in await ctx.store.evidence.get_many_evidence(wanted)}
    # twin programs cite their trial records even when no claim does, so those links must resolve
    twin_sources = {i for t in (twin.twins if twin else []) for i in t.source_ids}
    sources = {
        s.id: s
        for s in await ctx.store.evidence.get_sources(
            sorted({e.source_id for e in evidence.values()} | twin_sources)
        )
    }
    # last line of defence: no accepted claim may point at evidence the store does not have
    claims = gate_claims(cited, set(evidence))
    ctx.log(f"{len(claims)} claims, {len(evidence)} evidence items, {len(sources)} sources")

    synthetic = any(c.text.startswith(_FIXTURE_MARK) for c in claims.values()) or any(
        s.title.startswith(_FIXTURE_MARK) for s in sources.values()
    )
    report = UnderwritingReport(
        run_id=ctx.run_id,
        program=program,
        entities=entities,
        verdict=verdict,
        pos=pos,
        sections=state.get("sections", {}),
        translation_chain=state.get("translation_chain", []),
        twin_stats=twin,
        ledger=ledger,
        assessments=assessments,
        valuation=state.get("valuation"),
        key_risks=state.get("key_risks", []),
        critical_unknowns=state.get("critical_unknowns", []),
        diligence_questions=state.get("diligence_questions", [])[:10],
        claims=claims,
        evidence=evidence,
        sources=sources,
        # the runner overwrites everything but `synthetic` once it knows tokens, cost and timing
        meta=RunMeta(effort=state["options"].effort, created_at=utcnow(), synthetic=synthetic),
    )
    return {"report": report}
