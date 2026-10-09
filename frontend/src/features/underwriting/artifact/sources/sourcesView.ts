import type { SourceRef, UnderwritingReport } from "../../../../api/types";

export interface SourceRow {
  source: SourceRef;
  evidenceCount: number;
  /** claims that cite this source through any of its evidence, rejected ones included */
  claimIds: string[];
}

export type SortKey = "title" | "type" | "publisher" | "published" | "retrieved" | "claims";
export type SortDir = "asc" | "desc";

export function buildSourceRows(report: UnderwritingReport): SourceRow[] {
  const evidenceBySource = new Map<string, number>();
  for (const e of Object.values(report.evidence)) evidenceBySource.set(e.source_id, (evidenceBySource.get(e.source_id) ?? 0) + 1);
  const claimsBySource = new Map<string, Set<string>>();
  for (const claim of Object.values(report.claims)) {
    for (const id of claim.evidence_ids) {
      const sourceId = report.evidence[id]?.source_id;
      if (sourceId) claimsBySource.set(sourceId, (claimsBySource.get(sourceId) ?? new Set()).add(claim.id));
    }
  }
  return Object.values(report.sources).map((source) => ({
    source,
    evidenceCount: evidenceBySource.get(source.id) ?? 0,
    claimIds: [...(claimsBySource.get(source.id) ?? [])],
  }));
}

/** The sources the analysis went and found: everything except the files the user uploaded, which have their own list. */
export function analysisSources(report: UnderwritingReport): UnderwritingReport {
  const found = Object.fromEntries(Object.entries(report.sources).filter(([, s]) => !s.identifiers?.document));
  return { ...report, sources: found };
}

/** How many there are and who published them, most first, for a header that is read before the table is opened. */
export function summarizeSources(report: UnderwritingReport): { count: number; publishers: string[] } {
  const counts = new Map<string, number>();
  for (const s of Object.values(report.sources)) counts.set(s.publisher, (counts.get(s.publisher) ?? 0) + 1);
  return { count: Object.keys(report.sources).length, publishers: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name) };
}

const value = (row: SourceRow, key: SortKey): string | number => {
  switch (key) {
    case "title": return row.source.title.toLowerCase();
    case "type": return row.source.type;
    case "publisher": return row.source.publisher.toLowerCase();
    case "published": return row.source.published_at ? new Date(row.source.published_at).getTime() : Number.NEGATIVE_INFINITY;
    case "retrieved": return new Date(row.source.retrieved_at).getTime();
    case "claims": return row.claimIds.length;
  }
}; // fmt: skip

export function sortRows(rows: SourceRow[], key: SortKey, dir: SortDir): SourceRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, key);
    const y = value(b, key);
    return (x < y ? -1 : x > y ? 1 : 0) * sign || a.source.title.localeCompare(b.source.title);
  });
}

export function filterSourceRows(rows: SourceRow[], filters: { type: string; query: string }): SourceRow[] {
  const needle = filters.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.type && r.source.type !== filters.type) return false;
    if (!needle) return true;
    const haystack = [r.source.title, r.source.publisher, r.source.url ?? "", ...Object.values(r.source.identifiers)].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
