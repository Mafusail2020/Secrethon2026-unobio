import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../client";
import { mockApi } from "./index";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The mock answers after a short delay and runs on its own clock: let that clock run until the call is answered. */
async function answered<T>(call: Promise<T>): Promise<T> {
  let over = false;
  const result = call.finally(() => void (over = true));
  result.catch(() => {});
  while (!over) await vi.advanceTimersByTimeAsync(100);
  return result;
}

const finished = async (id: string) => {
  for (let i = 0; i < 200; i++) {
    if ((await answered(mockApi.listRuns())).find((r) => r.id === id)?.status === "completed") return;
    await vi.advanceTimersByTimeAsync(100);
  }
  throw new Error(`${id} did not finish`);
};

describe("the mock's delete", () => {
  it("refuses while a run is working, then removes the run with the versions made from it", async () => {
    const parent = await answered(mockApi.createRun({ program: { indication: "Multiple sclerosis", mechanism: "BTK inhibition" } } as never));
    await expect(answered(mockApi.deleteRun(parent.id))).rejects.toMatchObject({ status: 409, code: "run_active" });
    await finished(parent.id);
    const child = await answered(mockApi.createCorrection(parent.id, "verdict", { text: "the earlier trials were terminated" } as never));
    await finished(child.id);
    const other = await answered(mockApi.createRun({ program: { indication: "Asthma", mechanism: "IL5 blockade" } } as never));
    await finished(other.id);

    await answered(mockApi.deleteRun(parent.id));
    expect((await answered(mockApi.listRuns())).map((r) => r.id)).toEqual([other.id]);
    // the mock's getRun throws at once instead of returning a rejected promise
    expect(() => mockApi.getRun(child.id)).toThrow(ApiError);
    await expect(answered(mockApi.deleteRun(parent.id))).rejects.toMatchObject({ status: 404 });
  });
});
