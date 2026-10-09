import type { Claim, EvidenceLedger, SourceRef, UnderwritingReport } from "../../../../../api/types";
import { LABEL_ORDER } from "../labels";

type Cause = EvidenceLedger["by_cause"][number]["cause"];

export const CAUSE_LABEL: Record<Cause, string> = {
  efficacy: "Efficacy",
  safety: "Safety",
  pk_exposure: "Exposure",
  commercial: "Commercial",
  other: "Other",
};

export interface CauseRow {
  cause: Cause;
  label: string;
  /** cumulative hazard before and after the evidence: how much failure this cause stands for */
  before: number;
  after: number;
  /** riskier, safer, or unmoved */
  change: "up" | "down" | "same";
}

/** Where the risk of failing comes from, and how the evidence moved each part. Causes with no hazard are left out. */
export function causeRows(ledger: EvidenceLedger): CauseRow[] {
  return ledger.by_cause
    .filter((c) => c.hazard_prior.base > 0 || c.hazard_posterior.base > 0)
    .map((c) => {
      const before = c.hazard_prior.base;
      const after = c.hazard_posterior.base;
      const change: CauseRow["change"] = after > before * 1.005 ? "up" : after < before * 0.995 ? "down" : "same";
      return { cause: c.cause, label: CAUSE_LABEL[c.cause], before, after, change };
    });
}

export interface LabelSlice {
  label: Claim["label"];
  count: number;
  share: number;
}

/** How the claims that count are labelled: what was read from a source, worked out, or only believed. */
export function labelMix(claims: Claim[]): LabelSlice[] {
  const live = claims.filter((c) => c.status !== "rejected");
  return LABEL_ORDER.map((label) => ({ label, count: live.filter((c) => c.label === label).length, share: 0 }))
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, share: s.count / live.length }));
}

/** The share of counted claims that rest on a fact read from a source or computed from one. */
export function groundedShare(mix: LabelSlice[]): number {
  return mix.filter((s) => s.label === "extracted" || s.label === "derived").reduce((sum, s) => sum + s.share, 0);
}

export const SOURCE_TYPE_LABEL: Record<SourceRef["type"], string> = {
  paper: "Papers",
  preprint: "Preprints",
  trial: "Trial records",
  label: "Drug labels",
  approval: "Approvals",
  db_record: "Database records",
  filing: "Filings",
  user_provided: "Provided by you",
  web: "Web pages",
};

/** The sources the counted claims actually cite, by kind, most first. */
export function sourceMix(report: UnderwritingReport): { type: SourceRef["type"]; label: string; value: number }[] {
  const cited = new Set<string>();
  for (const claim of Object.values(report.claims)) {
    if (claim.status === "rejected") continue;
    for (const id of claim.evidence_ids) {
      const sourceId = report.evidence[id]?.source_id;
      if (sourceId && report.sources[sourceId]) cited.add(sourceId);
    }
  }
  const counts = new Map<SourceRef["type"], number>();
  for (const id of cited) {
    const type = report.sources[id]!.type;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts].map(([type, value]) => ({ type, label: SOURCE_TYPE_LABEL[type], value })).sort((a, b) => b.value - a.value);
}
