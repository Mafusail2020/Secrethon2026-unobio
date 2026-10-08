import type { Claim, UnderwritingReport } from "../../../../api/types";

export interface ClaimFilters {
  stance: ReadonlySet<Claim["stance"]>;
  label: ReadonlySet<Claim["label"]>;
  status: ReadonlySet<Claim["status"]>;
  confidence: ReadonlySet<Claim["confidence"]>;
  query: string;
}

export const emptyFilters: ClaimFilters = {
  stance: new Set(),
  label: new Set(),
  status: new Set(),
  confidence: new Set(),
  query: "",
};

export function isFiltering(f: ClaimFilters): boolean {
  return f.stance.size + f.label.size + f.status.size + f.confidence.size > 0 || f.query.trim() !== "";
}

export function toggleValue<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/** An empty facet means "any". Text search covers the claim, its rejection reason and its evidence quotes. */
export function filterClaims(claims: Claim[], f: ClaimFilters, report?: UnderwritingReport): Claim[] {
  const needle = f.query.trim().toLowerCase();
  return claims.filter((c) => {
    if (f.stance.size && !f.stance.has(c.stance)) return false;
    if (f.label.size && !f.label.has(c.label)) return false;
    if (f.status.size && !f.status.has(c.status)) return false;
    if (f.confidence.size && !f.confidence.has(c.confidence)) return false;
    if (!needle) return true;
    const haystack = [
      c.text,
      c.rejection_reason ?? "",
      ...c.evidence_ids.map((id) => report?.evidence[id]?.excerpt ?? ""),
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function facetCounts<K extends "stance" | "label" | "status" | "confidence">(
  claims: Claim[],
  key: K,
): Map<Claim[K], number> {
  const counts = new Map<Claim[K], number>();
  for (const c of claims) counts.set(c[key], (counts.get(c[key]) ?? 0) + 1);
  return counts;
}
