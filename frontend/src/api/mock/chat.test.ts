import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "./index";

const program = { indication: "Alzheimer's disease", mechanism: "BACE1 inhibition", links: [] };
const ask = (id: string, content: string) =>
  mockApi.postMessage(id, { role: "user", content, run_id: id, cited_claim_ids: [], cited_evidence_ids: [] });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function startRun() {
  const created = mockApi.createRun({ program });
  await vi.advanceTimersByTimeAsync(60);
  return (await created).id;
}

describe("mock follow-up chat", () => {
  it("refuses questions before the run has a report", async () => {
    const id = await startRun();
    expect(() => ask(id, "why?")).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("remembers the exchange per run and cites claims of the report", async () => {
    const id = await startRun();
    await vi.advanceTimersByTimeAsync(60_000);
    const pending = mockApi.getReport(id);
    await vi.advanceTimersByTimeAsync(50);
    const report = await pending;

    const asked = ask(id, "  why conditional?  ");
    await vi.advanceTimersByTimeAsync(50);
    const reply = await asked;
    expect(reply.role).toBe("assistant");
    expect(reply.cited_claim_ids.length).toBeGreaterThan(0);
    expect(reply.cited_claim_ids.every((c) => c in report.claims)).toBe(true);

    const history = mockApi.getMessages(id);
    await vi.advanceTimersByTimeAsync(50);
    expect((await history).map((m) => [m.role, m.content.slice(0, 12)])).toEqual([
      ["user", "why conditio"],
      ["assistant", "Mock reply t"],
    ]);
  });

  it("writes a briefing that cites the passages of an uploaded file, and chat can cite them too", async () => {
    const file = new File(["Abeta42 fell 62 percent."], "study.txt", { type: "text/plain" });
    const uploaded = mockApi.uploadDocument(file);
    await vi.advanceTimersByTimeAsync(50);
    const info = await uploaded;
    const created = mockApi.createRun({ program: { ...program, document_ids: [info.id] } });
    await vi.advanceTimersByTimeAsync(60);
    const id = (await created).id;
    await vi.advanceTimersByTimeAsync(60_000);
    const written = mockApi.postSummary(id);
    await vi.advanceTimersByTimeAsync(50);
    const briefing = await written;
    expect(briefing.content).toContain("## Your documents");
    expect(briefing.cited_evidence_ids.length).toBeGreaterThan(0);
    for (const passage of briefing.cited_evidence_ids) expect(briefing.content).toContain(`[[${passage}]]`);
    const detail = mockApi.getEvidence(briefing.cited_evidence_ids[0]!);
    await vi.advanceTimersByTimeAsync(50);
    expect((await detail).source.identifiers.document).toBe(info.id);
    const asked = ask(id, "what does my file say?");
    await vi.advanceTimersByTimeAsync(50);
    expect((await asked).cited_evidence_ids).toEqual(briefing.cited_evidence_ids.slice(0, 2));
  });

  it("writes no document section for a run that read no files", async () => {
    const id = await startRun();
    await vi.advanceTimersByTimeAsync(60_000);
    const written = mockApi.postSummary(id);
    await vi.advanceTimersByTimeAsync(50);
    const briefing = await written;
    expect(briefing.content).not.toContain("## Your documents");
    expect(briefing.cited_evidence_ids).toEqual([]);
  });
});
