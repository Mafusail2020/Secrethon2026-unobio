from app.contracts import Claim, UnderwritingReport

MAX_CLAIMS = 60
# the gateway refuses prompts past ~14k chars, system prompt included (measured)
MAX_CHARS = 11_000
_CONFIDENCE = {"high": 0, "medium": 1, "low": 2}


def usable_claims(report: UnderwritingReport) -> list[Claim]:
    """Claims the answer may rest on: accepted first, then downgraded; rejected ones never."""
    kept = [c for c in report.claims.values() if c.status != "rejected"]
    kept.sort(key=lambda c: (c.status != "accepted", _CONFIDENCE[c.confidence], c.section, c.id))
    return kept[:MAX_CLAIMS]


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def build_context(report: UnderwritingReport, max_chars: int = MAX_CHARS) -> tuple[str, set[str]]:
    """The report as plain text for the model, and the claim ids it may cite."""
    program, verdict = report.program, report.verdict
    lines = [
        f"PROGRAM: {program.indication} / {program.mechanism}",
        f"VERDICT: {verdict.decision} ({verdict.confidence} confidence), "
        f"probability of success {report.pos.base:.3f} "
        f"(range {report.pos.low:.3f} to {report.pos.high:.3f})",
        f"RATIONALE: {verdict.rationale}",
    ]
    lines += [
        f"REASON ({r.direction}): {r.text} [claims: {', '.join(r.claim_ids) or 'none'}]"
        for r in verdict.reason_codes
    ]
    claims = usable_claims(report)
    head, lines = lines, []
    for s in report.sections.values():
        unknown = f" Unknown: {_clip('; '.join(s.unknowns), 80)}." if s.unknowns else ""
        lines.append(f"SECTION {s.title} ({s.status}): {_clip(s.summary, 160)}{unknown}")
        for point in s.key_points[:2]:
            ids = ", ".join(point.claim_ids) or "none"
            lines.append(f"    - {_clip(point.text, 120)} [claims: {ids}]")
    if report.translation_chain:
        steps = "; ".join(
            f"{link.step.replace('_', ' ')} {link.status}" for link in report.translation_chain
        )
        lines.append(f"TRANSLATION CHAIN: {steps}")
    for risk in report.key_risks[:4]:
        ids = ", ".join(risk.claim_ids) or "none"
        lines.append(
            f"RISK ({risk.severity} {risk.category}): {_clip(risk.text, 150)} [claims: {ids}]"
        )
    for question in report.diligence_questions[:3]:
        why = _clip(question.why_it_matters, 60)
        lines.append(f"DILIGENCE: {_clip(question.question, 120)} (why: {why})")
    if report.twin_stats:
        t = report.twin_stats
        lines.append(f"TWINS: {t.n_programs} similar programs, prior {t.prior_pos.base:.3f}")
    if report.ledger:
        if report.ledger.failure_mix:
            mix = report.ledger.failure_mix
            parts = ", ".join(f"{x.cause} {x.share.base:.0%}" for x in mix.shares)
            lines.append(f"FAILURE MIX ({mix.source}): {parts}")
        steps = "; ".join(
            f"{s.factor} [{s.cause}] x{s.risk_ratio.base:.2f} on that risk ({s.basis})"
            for s in report.ledger.steps
        )
        lines.append(f"LEDGER: {steps or 'no steps'}")
    for result in report.assessments:
        metrics = "; ".join(
            f"{m.label} {m.value:g}{(' ' + m.unit) if m.unit else ''}"
            for m in result.metrics
            if m.value is not None
        )
        lines.append(f"ASSESSMENT {result.cause} ({result.rating}): {_clip(result.headline, 160)}")
        if metrics:
            lines.append(f"    metrics: {_clip(metrics, 200)}")
        if result.gaps:
            lines.append(f"    could not check: {_clip('; '.join(result.gaps), 200)}")
    if report.valuation:
        v = report.valuation
        lines.append(
            f"VALUATION: next milestone {v.next_milestone}; "
            f"capital {v.capital_to_milestone.base:,.0f} USD; "
            f"time {v.time_to_milestone_months.base:.0f} months; rNPV {v.rnpv.base:,.0f} USD"
        )
    # the verdict, sections and numbers always go in; claims fill what is left, best first
    top = "".join(line + "\n" for line in head)
    rest = "".join(line + "\n" for line in lines)
    budget = max_chars - len(top) - len(rest) - 200
    body = "CLAIMS (cite these ids only):\n"
    for n, c in enumerate(claims):
        note = " downgraded" if c.status == "downgraded" else ""
        block = f"[{c.id}] {c.stance}/{c.label}/{c.confidence}{note}: {_clip(c.text, 220)}\n"
        for evidence_id in c.evidence_ids[:1]:
            evidence = report.evidence.get(evidence_id)
            source = report.sources.get(evidence.source_id) if evidence else None
            if evidence and source:
                block += f'    evidence ({source.title}): "{_clip(evidence.excerpt, 160)}"\n'
        if len(body) + len(block) > budget:
            body += f"({len(claims) - n} more claims not shown for length.)\n"
            break
        body += block
    rejected = sum(c.status == "rejected" for c in report.claims.values())
    if rejected:
        body += (
            f"({rejected} further claims were rejected by the evidence gate and are not shown.)\n"
        )
    return (top + body + rest)[:max_chars], {c.id for c in claims}
