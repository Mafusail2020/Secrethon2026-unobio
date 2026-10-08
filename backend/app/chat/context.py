from app.contracts import Claim, UnderwritingReport

MAX_CLAIMS = 60
MAX_CHARS = 18_000
_CONFIDENCE = {"high": 0, "medium": 1, "low": 2}


def usable_claims(report: UnderwritingReport) -> list[Claim]:
    """Claims the answer may rest on: accepted first, then downgraded; rejected ones never."""
    kept = [c for c in report.claims.values() if c.status != "rejected"]
    kept.sort(key=lambda c: (c.status != "accepted", _CONFIDENCE[c.confidence], c.section, c.id))
    return kept[:MAX_CLAIMS]


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def build_context(report: UnderwritingReport) -> tuple[str, set[str]]:
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
    lines.append("CLAIMS (cite these ids only):")
    for c in claims:
        note = " downgraded" if c.status == "downgraded" else ""
        lines.append(f"[{c.id}] {c.stance}/{c.label}/{c.confidence}{note}: {_clip(c.text, 300)}")
        for evidence_id in c.evidence_ids[:2]:
            evidence = report.evidence.get(evidence_id)
            source = report.sources.get(evidence.source_id) if evidence else None
            if evidence and source:
                lines.append(f'    evidence ({source.title}): "{_clip(evidence.excerpt, 200)}"')
    rejected = sum(c.status == "rejected" for c in report.claims.values())
    if rejected:
        lines.append(
            f"({rejected} further claims were rejected by the evidence gate and are not shown.)"
        )
    for s in report.sections.values():
        unknown = f" Unknown: {'; '.join(s.unknowns)}." if s.unknowns else ""
        lines.append(f"SECTION {s.title} ({s.status}): {_clip(s.summary, 300)}{unknown}")
        for point in s.key_points[:4]:
            ids = ", ".join(point.claim_ids) or "none"
            lines.append(f"    - {_clip(point.text, 200)} [claims: {ids}]")
    if report.translation_chain:
        steps = "; ".join(
            f"{link.step.replace('_', ' ')} {link.status}" for link in report.translation_chain
        )
        lines.append(f"TRANSLATION CHAIN: {steps}")
    for risk in report.key_risks[:8]:
        ids = ", ".join(risk.claim_ids) or "none"
        lines.append(
            f"RISK ({risk.severity} {risk.category}): {_clip(risk.text, 200)} [claims: {ids}]"
        )
    for question in report.diligence_questions[:6]:
        why = _clip(question.why_it_matters, 160)
        lines.append(f"DILIGENCE: {_clip(question.question, 160)} (why: {why})")
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
        lines.append(f"ASSESSMENT {result.cause} ({result.rating}): {_clip(result.headline, 240)}")
        if metrics:
            lines.append(f"    metrics: {_clip(metrics, 300)}")
        if result.gaps:
            lines.append(f"    could not check: {_clip('; '.join(result.gaps), 200)}")
    if report.valuation:
        v = report.valuation
        lines.append(
            f"VALUATION: next milestone {v.next_milestone}; "
            f"capital {v.capital_to_milestone.base:,.0f} USD; "
            f"time {v.time_to_milestone_months.base:.0f} months; rNPV {v.rnpv.base:,.0f} USD"
        )
    text = ""
    for line in lines:
        if len(text) + len(line) + 1 > MAX_CHARS:
            text += "(context truncated)\n"
            break
        text += line + "\n"
    return text, {c.id for c in claims}
