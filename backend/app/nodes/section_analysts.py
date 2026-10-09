import asyncio
from typing import Any

from pydantic import Field

from app.contracts import (
    SECTION_IDS,
    Claim,
    DiligenceQuestion,
    KeyPoint,
    NodeSpec,
    PanelResult,
    Risk,
    SectionId,
    SectionResult,
)
from app.contracts.claims import DiligenceRequirement, RiskCategory
from app.contracts.common import Severity
from app.graph.provenance import gate_claims
from app.graph.state import GraphState
from app.nodes._analysis import (
    OUT_TOKENS,
    Draft,
    DraftClaim,
    ask_fitted,
    describe_program,
    digest,
    fixture_run,
    gate,
    instructions,
    prompt,
    system_prompt,
    to_claims,
    usable_evidence,
)
from app.nodes._data import entity_ids
from app.nodes._fixture import excluded_ids, fixture_report, nap, touch_llm
from app.nodes.base import NodeContext
from app.nodes.subgraphs.bull_bear import rank_hits

SPEC = NodeSpec(
    id="section_analysts",
    label="Section analysts",
    kind="analysis",
    phase="analyse",
    description="Writes each report section plus the risks, unknowns and diligence questions, using the efficacy and safety lanes' claims and scores.",
    reads=[
        "program",
        "entities",
        "questions",
        "claims",
        "twin_stats",
        "translation_chain",
        "assessments",
        "scratch",
        "evidence_ids",
    ],
    writes=[
        "sections",
        "claims",
        "key_risks",
        "critical_unknowns",
        "diligence_questions",
    ],
    correctable=True,
    critical=False,
)

TITLES: dict[str, str] = {
    "disease_need": "Disease need",
    "scientific_thesis": "Scientific thesis",
    "translation": "Translation",
    "safety": "Safety",
    "clinical_plan": "Clinical plan",
    "competition": "Competition",
    "commercial_adoption": "Commercial adoption",
    "capital": "Capital",
    "risks": "Risks",
}
MAX_NEW_CLAIMS = 4
MAX_SHOWN_CLAIMS = 18
MAX_DILIGENCE = 10
# the gateway refuses long inputs (see _analysis.DIGEST_CHARS); the risks call also carries a
# bigger reply schema, every section's summary and the most claims
USER_CHARS = 10000
MIN_DIGEST_CHARS = 1500
CLAIM_CHARS = 220
SUMMARY_CHARS = 300
NEW = "new:"


class _Point(Draft):
    text: str
    claim_ids: list[str] = Field(default_factory=list, description='Claim ids or "new:<index>".')


class SectionDraft(Draft):
    summary: str
    key_points: list[_Point] = Field(default_factory=list)
    new_claims: list[DraftClaim] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)


class _Risk(Draft):
    category: RiskCategory
    text: str
    severity: Severity
    claim_ids: list[str] = Field(default_factory=list)


class _Question(Draft):
    question: str
    why_it_matters: str
    requires: list[DiligenceRequirement] = Field(default_factory=list)
    priority: int = Field(ge=1)
    claim_ids: list[str] = Field(default_factory=list)


class RisksDraft(SectionDraft):
    key_risks: list[_Risk] = Field(default_factory=list)
    critical_unknowns: list[str] = Field(default_factory=list)
    diligence_questions: list[_Question] = Field(default_factory=list)


def _claims_block(claims: list[Claim]) -> str:
    if not claims:
        return "(none)"
    return "\n".join(
        f"[{c.id}] ({c.stance}, {c.label}, {c.confidence} confidence) {_cut(c.text, CLAIM_CHARS)}"
        for c in claims
    )


def _cut(text: str, n: int) -> str:
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + " …"


def _context(state: GraphState, section: str) -> str:
    lines = []
    for a in (state.get("assessments") or {}).values():
        lines.append(f"{a.cause} lane: {a.headline}")
        lines += [f"  gap: {g}" for g in a.gaps]
    twin = state.get("twin_stats")
    if twin is not None and section in ("clinical_plan", "capital", "risks", "scientific_thesis"):
        lines.append(
            f"precedent: {twin.match_level}, {twin.n_programs} comparable programs, prior "
            f"probability of approval {twin.prior_pos.base:.0%} "
            f"({twin.prior_pos.low:.0%}-{twin.prior_pos.high:.0%})"
        )
        lines += [
            f"  {t.drug} in {t.disease}: {t.max_stage}, {t.status}"
            + (f" ({t.stop_reason})" if t.stop_reason else "")
            for t in twin.twins[:8]
        ]
    chain = state.get("translation_chain") or []
    if chain and section in ("translation", "scientific_thesis", "risks"):
        lines.append(
            "translation chain (efficacy lane): "
            + ", ".join(f"{link.step} {link.status}" for link in chain)
        )
    return "Context from the quant steps (not citable):\n" + "\n".join(lines) if lines else ""


def resolve_ids(ids: list[str], new_ids: list[str | None], usable: set[str]) -> list[str]:
    """Point ids -> claim ids that exist and survived the gate; 'new:i' is this section's i-th claim."""
    out = []
    for raw in ids:
        ref = raw.strip()
        if ref.startswith(NEW):
            try:
                ref = new_ids[int(ref[len(NEW) :])] or ""
            except (ValueError, IndexError):
                continue
        if ref in usable:
            out.append(ref)
    return list(dict.fromkeys(out))


def settle_section(
    section: str,
    drafted: SectionDraft | None,
    new_ids: list[str | None],
    usable: set[str],
    panel: PanelResult | None,
) -> SectionResult:
    if drafted is None:
        return SectionResult(
            section=section,  # type: ignore[arg-type]
            title=TITLES[section],
            summary="The analyst produced no usable answer for this section.",
            unknowns=["section not written: the model reply could not be used"],
            status="insufficient_evidence",
            produced_by=SPEC.id,
            panel=panel,
        )
    points = [
        KeyPoint(text=" ".join(p.text.split()), claim_ids=resolve_ids(p.claim_ids, new_ids, usable))
        for p in drafted.key_points
    ]
    kept = [p for p in points if p.claim_ids and p.text]
    unknowns = [" ".join(u.split()) for u in drafted.unknowns if u.strip()]
    if not kept:
        status = "insufficient_evidence"
        unknowns.append("no key point is backed by a checked claim")
    elif len(kept) < len(points) or len(kept) < 2:
        status = "partial"
    else:
        status = "ok"
    return SectionResult(
        section=section,  # type: ignore[arg-type]
        title=TITLES[section],
        summary=" ".join(drafted.summary.split()),
        key_points=kept,
        unknowns=unknowns,
        status=status,  # type: ignore[arg-type]
        produced_by=SPEC.id,
        panel=panel,
    )


async def _write(
    state: GraphState,
    ctx: NodeContext,
    section: str,
    claims: dict[str, Claim],
    others: str = "",
) -> tuple[SectionResult, dict[str, Claim], RisksDraft | None, list[str | None]]:
    questions = [q for q in state.get("questions", []) if q.section == section]
    risks = section == "risks"
    shown = [
        c for c in claims.values() if c.status != "rejected" and (risks or c.section == section)
    ]
    if risks:
        shown.sort(key=lambda c: c.stance != "con")
    shown = shown[:MAX_SHOWN_CLAIMS]
    queries = [q.question for q in questions[:3]] or [
        f"{TITLES[section]} {state['program'].indication}"
    ]
    ids, k = entity_ids(state.get("entities")), ctx.effort.retrieval_k
    hits = [[e.id for e in await ctx.retriever.retrieve(q, ids, None, k)] for q in queries]
    provided = rank_hits(hits, max(8, 2 * k))

    candidates, listed = provided, shown

    async def build(scale: float) -> tuple[str, list[str]]:
        nonlocal shown
        shown = listed[: max(4, int(len(listed) * scale))]
        head = (
            f"{describe_program(state)}\n\n{prompt(f'sections/{section}')}\n\n"
            "Planned questions:\n"
            + ("\n".join(f"- {q.question}" for q in questions) or "- (none)")
            + f"\n\nChecked claims:\n{_claims_block(shown)}\n\n{_context(state, section)}\n\n"
            + (f"Other sections:\n{others}\n\n" if others else "")
        )
        # the risks section carries every claim and summary, so its evidence gets what is left
        budget = max(MIN_DIGEST_CHARS, USER_CHARS - len(head))
        evidence, seen = await digest(ctx, candidates, 500, int(budget * scale))
        user = f"{head}Evidence:\n{evidence}\n\nAt most {MAX_NEW_CLAIMS} new claims."
        if extra := instructions(ctx):
            user += f"\n\n{extra}"
        return user, seen

    system = system_prompt("section") + (f"\n\n{prompt('risks_extra')}" if risks else "")
    ctx.progress(f"writing {section}")
    drafted, result, provided = await ask_fitted(
        ctx,
        f"section_analysts.{section}",
        system,
        build,
        RisksDraft if risks else SectionDraft,
        OUT_TOKENS["risks" if risks else "section"],
    )
    drafts = (drafted.new_claims if drafted else [])[:MAX_NEW_CLAIMS]
    new_claims, quotes = to_claims(
        (d.model_copy(update={"section": section}) for d in drafts), SPEC.id
    )
    valid = set(provided) & usable_evidence(state)
    gated = await gate(ctx, new_claims, quotes, valid)
    by_text = {c.text: c.id for c in gated.values()}
    new_ids = [by_text.get(" ".join(d.text.split())) for d in drafts]
    usable = {c.id for c in shown} | {i for i, c in gated.items() if c.status != "rejected"}
    settled = settle_section(section, drafted, new_ids, usable, result.panel if result else None)
    return settled, gated, drafted if isinstance(drafted, RisksDraft) else None, new_ids


def settle_risks(
    drafted: RisksDraft | None, new_ids: list[str | None], usable: set[str]
) -> tuple[list[Risk], list[str], list[DiligenceQuestion]]:
    if drafted is None:
        return [], [], []
    risks = [
        Risk(
            category=r.category,
            text=" ".join(r.text.split()),
            severity=r.severity,
            claim_ids=resolve_ids(r.claim_ids, new_ids, usable),
        )
        for r in drafted.key_risks
    ]
    questions = sorted(drafted.diligence_questions, key=lambda q: q.priority)[:MAX_DILIGENCE]
    diligence = [
        DiligenceQuestion(
            question=" ".join(q.question.split()),
            why_it_matters=" ".join(q.why_it_matters.split()),
            requires=list(dict.fromkeys(q.requires)),
            priority=i,
            claim_ids=resolve_ids(q.claim_ids, new_ids, usable),
        )
        for i, q in enumerate(questions, 1)
    ]
    unknowns = [" ".join(u.split()) for u in drafted.critical_unknowns if u.strip()]
    # a risk with nothing behind it is an open question, not a finding
    return (
        [r for r in risks if r.claim_ids],
        unknowns + [f"unsupported risk: {r.text}" for r in risks if not r.claim_ids],
        diligence,
    )


async def run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
    if fixture_run(state):
        return await _fixture_run(state, ctx)
    claims = dict(state.get("claims", {}))
    first = [s for s in SECTION_IDS if s != "risks"]
    written = await asyncio.gather(*(_write(state, ctx, s, claims) for s in first))
    sections: dict[SectionId, SectionResult] = {}
    own: dict[str, Claim] = {}
    for result, gated, _, _ in written:
        sections[result.section] = result
        own.update(gated)

    others = "\n".join(f"- {s.title}: {_cut(s.summary, SUMMARY_CHARS)}" for s in sections.values())
    risks_result, gated, risks_draft, new_ids = await _write(
        state, ctx, "risks", {**claims, **own}, others
    )
    sections["risks"] = risks_result
    own.update(gated)
    usable = {i for i, c in {**claims, **own}.items() if c.status != "rejected"}
    key_risks, unknowns, diligence = settle_risks(risks_draft, new_ids, usable)

    statuses = [s.status for s in sections.values()]
    ctx.log(
        f"wrote {len(sections)} sections ({statuses.count('ok')} ok, {statuses.count('partial')} "
        f"partial, {statuses.count('insufficient_evidence')} insufficient), {len(own)} new claims, "
        f"{len(key_risks)} key risks, {len(diligence)} diligence questions"
    )
    rejected = sum(c.status == "rejected" for c in own.values())
    if rejected:
        ctx.log(f"{rejected} new claim(s) rejected by the gate")
    return {
        "sections": sections,
        "claims": own,
        "key_risks": key_risks,
        "critical_unknowns": unknowns,
        "diligence_questions": diligence,
    }


async def _fixture_run(state: GraphState, ctx: NodeContext) -> dict[str, Any]:
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
        "key_risks": [r for r in risks if r.claim_ids],
        "critical_unknowns": fixture.critical_unknowns,
        "diligence_questions": questions,
    }
