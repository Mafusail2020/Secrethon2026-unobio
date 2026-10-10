import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, liveApi } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("deleting a run", () => {
  it("calls DELETE and reads nothing from the empty answer", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(liveApi.deleteRun("run_1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/runs/run_1", { method: "DELETE" });
  });

  it("raises the server's reason when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "run_active", message: "a run that is still working cannot be deleted", details: [] } }), { status: 409 })),
    );
    const failed = await liveApi.deleteRun("run_1").catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ApiError);
    expect(failed).toMatchObject({ status: 409, code: "run_active", message: "a run that is still working cannot be deleted" });
  });
});
