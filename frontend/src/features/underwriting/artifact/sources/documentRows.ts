import type { DocumentInfo, RunSummary, UnderwritingReport } from "../../../../api/types";

export interface DocumentRow {
  id: string;
  /** undefined while its name is still being fetched */
  info: DocumentInfo | undefined;
  /** the run being looked at read it */
  inRun: boolean;
  checked: boolean;
  /** evidence items of this run that came out of the document, and claims citing any of them */
  evidence: number;
  citedBy: number;
}

/** Every document any version of the run was given, oldest version first, so one left out of a version can be put back. */
export function lineageDocumentIds(versions: Pick<RunSummary, "program">[]): string[] {
  return [...new Set(versions.flatMap((v) => v.program.document_ids ?? []))];
}

/** What a run took from a document. The ingest step marks the sources it makes from a file with identifiers.document. */
export function documentUse(report: UnderwritingReport | undefined, documentId: string): { evidence: number; citedBy: number } {
  if (!report) return { evidence: 0, citedBy: 0 };
  const sources = new Set(Object.values(report.sources).filter((s) => s.identifiers?.document === documentId).map((s) => s.id));
  const evidence = Object.values(report.evidence).filter((e) => sources.has(e.source_id)).map((e) => e.id);
  const own = new Set(evidence);
  const citedBy = Object.values(report.claims).filter((c) => c.status !== "rejected" && c.evidence_ids.some((id) => own.has(id))).length;
  return { evidence: evidence.length, citedBy };
}

interface Inputs {
  runIds: string[];
  lineageIds: string[];
  /** files added in this view, not yet part of any version */
  uploaded: DocumentInfo[];
  /** boxes the reader has ticked or cleared; anything absent keeps its starting state */
  choices: Record<string, boolean>;
  infos: Record<string, DocumentInfo | undefined>;
  report: UnderwritingReport | undefined;
}

export function buildDocumentRows({ runIds, lineageIds, uploaded, choices, infos, report }: Inputs): DocumentRow[] {
  const known = new Map<string, DocumentInfo | undefined>(Object.entries(infos));
  for (const u of uploaded) known.set(u.id, u);
  const added = new Set(uploaded.map((u) => u.id));
  const ids = [...new Set([...lineageIds, ...uploaded.map((u) => u.id)])];
  return ids.map((id) => {
    const inRun = runIds.includes(id);
    return {
      id,
      info: known.get(id),
      inRun,
      checked: choices[id] ?? (inRun || added.has(id)),
      ...documentUse(report, id),
    };
  });
}

export const selectionOf = (rows: DocumentRow[]): string[] => rows.filter((r) => r.checked).map((r) => r.id);

export function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set([...a, ...b]).size === a.length;
}

const nameOf = (rows: DocumentRow[], id: string) => rows.find((r) => r.id === id)?.info?.name ?? id;

/** The note stored with the new version, so the history says which files it read. */
export function changeNote(rows: DocumentRow[], runIds: string[]): string {
  const now = selectionOf(rows);
  const names = (ids: string[]) => ids.map((id) => nameOf(rows, id)).join(", ");
  const parts = [
    now.length ? `Reads: ${names(now)}.` : "Reads no uploaded documents.",
    ...(runIds.filter((id) => !now.includes(id)).length ? [`Left out: ${names(runIds.filter((id) => !now.includes(id)))}.`] : []),
  ];
  return `Documents changed. ${parts.join(" ")}`.slice(0, 2000);
}
