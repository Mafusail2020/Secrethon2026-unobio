from collections.abc import Collection, Iterable

from app.contracts import Claim

# labels that assert something about the evidence and so must cite some
EVIDENCE_REQUIRED = frozenset({"extracted", "derived", "inferred"})


def gate_claim(claim: Claim, valid_evidence_ids: Collection[str]) -> Claim:
    """Reject claims without valid evidence, downgrade claims with partly invalid evidence."""
    if claim.status == "rejected":
        return claim
    cited = list(dict.fromkeys(claim.evidence_ids))
    kept = [i for i in cited if i in valid_evidence_ids]
    if claim.label in EVIDENCE_REQUIRED and not kept:
        reason = "no evidence cited" if not cited else "cited evidence is not in this run"
        return claim.model_copy(update={"status": "rejected", "rejection_reason": reason})
    if len(kept) < len(cited):
        missing = len(cited) - len(kept)
        return claim.model_copy(
            update={
                "evidence_ids": kept,
                "status": "downgraded",
                "confidence": "low",
                "rejection_reason": f"{missing} cited evidence id(s) not in this run",
            }
        )
    return claim


def gate_claims(claims: Iterable[Claim], valid_evidence_ids: Collection[str]) -> dict[str, Claim]:
    gated = (gate_claim(c, valid_evidence_ids) for c in claims)
    return {c.id: c for c in gated}
