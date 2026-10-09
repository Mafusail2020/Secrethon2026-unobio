import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { DocumentInfo, UnderwritingReport } from "../../../../api/types";
import { buildDocumentRows, changeNote, documentUse, lineageDocumentIds, sameSelection, selectionOf } from "./documentRows";

const base = reportJson as unknown as UnderwritingReport;
const doc = (id: string, name: string): DocumentInfo => ({ id: `doc_${id.padEnd(16, "0")}`, name, kind: "text", size_bytes: 10 });
const A = doc("a", "a.pdf");
const B = doc("b", "b.txt");
const C = doc("c", "c.md");

const withDocument = (id: string): UnderwritingReport => {
  const report = structuredClone(base);
  const [sourceId, source] = Object.entries(report.sources)[0]!;
  report.sources[sourceId] = { ...source, type: "user_provided", identifiers: { document: id } };
  return report;
};

describe("lineageDocumentIds", () => {
  it("keeps every document any version read, once, in the order they first appeared", () => {
    const versions = [{ program: { document_ids: [A.id, B.id] } }, { program: { document_ids: [B.id] } }, { program: { document_ids: [C.id, A.id] } }, { program: {} }];
    expect(lineageDocumentIds(versions as never)).toEqual([A.id, B.id, C.id]);
  });
});

describe("documentUse", () => {
  it("counts the evidence made from a document and the claims that cite it", () => {
    const report = withDocument(A.id);
    const sourceId = Object.keys(report.sources)[0]!;
    const own = Object.values(report.evidence).filter((e) => e.source_id === sourceId);
    const citing = Object.values(report.claims).filter((c) => c.status !== "rejected" && c.evidence_ids.some((id) => own.some((e) => e.id === id)));
    expect(own.length).toBeGreaterThan(0);
    expect(documentUse(report, A.id)).toEqual({ evidence: own.length, citedBy: citing.length });
  });

  it("is zero for a document the run did not read, or before there is a report", () => {
    expect(documentUse(withDocument(A.id), B.id)).toEqual({ evidence: 0, citedBy: 0 });
    expect(documentUse(undefined, A.id)).toEqual({ evidence: 0, citedBy: 0 });
  });
});

describe("buildDocumentRows", () => {
  const rows = (choices: Record<string, boolean> = {}) =>
    buildDocumentRows({ runIds: [A.id], lineageIds: [A.id, B.id], uploaded: [C], choices, infos: { [A.id]: A, [B.id]: B }, report: withDocument(A.id) });

  it("lists the run's documents, the ones an earlier version had, and new uploads; ticks what the run read and what was just added", () => {
    expect(rows().map((r) => [r.info?.name, r.inRun, r.checked])).toEqual([
      ["a.pdf", true, true],
      ["b.txt", false, false],
      ["c.md", false, true],
    ]);
  });

  it("lets a choice override the starting state either way", () => {
    expect(rows({ [A.id]: false, [B.id]: true }).map((r) => r.checked)).toEqual([false, true, true]);
  });

  it("shows what the run took from each document", () => {
    expect(rows()[0]!.evidence).toBeGreaterThan(0);
    expect(rows()[1]!.evidence).toBe(0);
  });

  it("leaves the name empty until it is known", () => {
    const loading = buildDocumentRows({ runIds: [A.id], lineageIds: [A.id], uploaded: [], choices: {}, infos: {}, report: undefined });
    expect(loading[0]!.info).toBeUndefined();
  });
});

describe("selection", () => {
  it("compares as sets, not lists", () => {
    expect(sameSelection([A.id, B.id], [B.id, A.id])).toBe(true);
    expect(sameSelection([A.id], [A.id, B.id])).toBe(false);
    expect(sameSelection([], [])).toBe(true);
  });

  it("writes a note that names what the new version reads and what it leaves out", () => {
    const rows = buildDocumentRows({ runIds: [A.id, B.id], lineageIds: [A.id, B.id], uploaded: [C], choices: { [B.id]: false }, infos: { [A.id]: A, [B.id]: B }, report: undefined });
    expect(selectionOf(rows)).toEqual([A.id, C.id]);
    expect(changeNote(rows, [A.id, B.id])).toBe("Documents changed. Reads: a.pdf, c.md. Left out: b.txt.");
    const none = rows.map((r) => ({ ...r, checked: false }));
    expect(changeNote(none, [A.id])).toBe("Documents changed. Reads no uploaded documents. Left out: a.pdf.");
  });
});
