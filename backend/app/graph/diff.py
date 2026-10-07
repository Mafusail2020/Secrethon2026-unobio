from app.contracts import ReportDiff, UnderwritingReport


def diff_reports(
    before: UnderwritingReport,
    after: UnderwritingReport,
    from_run: str,
    to_run: str,
    recomputed_nodes: list[str],
) -> ReportDiff:
    sections = set(before.sections) | set(after.sections)
    changed = sorted(
        s
        for s in sections
        if before.sections.get(s) is None
        or after.sections.get(s) is None
        or before.sections[s].model_dump() != after.sections[s].model_dump()
    )
    return ReportDiff(
        from_run=from_run,
        to_run=to_run,
        decision_before=before.verdict.decision,
        decision_after=after.verdict.decision,
        pos_before=before.pos,
        pos_after=after.pos,
        changed_sections=changed,  # type: ignore[arg-type]
        added_claim_ids=sorted(set(after.claims) - set(before.claims)),
        removed_claim_ids=sorted(set(before.claims) - set(after.claims)),
        recomputed_nodes=recomputed_nodes,
    )
