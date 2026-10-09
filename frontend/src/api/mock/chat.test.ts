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
});
