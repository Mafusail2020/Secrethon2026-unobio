import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "../../api/types";
import { Sidebar } from "./Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const run = (id: string, parent: string | null, at: string, extra: Partial<RunSummary> = {}) =>
  ({ id, status: "completed", program: { indication: "Multiple sclerosis", mechanism: `BTK ${id}`, links: [] }, options: { effort: "medium" }, created_at: at, parent_run_id: parent, decision: "conditional", error: null, ...extra }) as unknown as RunSummary;

let runs: RunSummary[];
let calls: string[];
let refuse: Response | undefined;

beforeEach(() => {
  calls = [];
  refuse = undefined;
  runs = [run("r1", null, "2026-10-01T10:00:00Z"), run("r2", "r1", "2026-10-01T11:00:00Z"), run("r3", null, "2026-10-02T10:00:00Z", { status: "running", decision: null })];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        calls.push(`DELETE ${url}`);
        if (refuse) return refuse;
        const doomed = new Set([url.split("/").pop()!, ...runs.filter((r) => r.parent_run_id === url.split("/").pop()).map((r) => r.id)]);
        runs = runs.filter((r) => !doomed.has(r.id));
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(runs), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

async function mount(at: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[at]}>
          <Where />
          <Routes>
            <Route path="*" element={<Sidebar currentId={at.split("/").pop()} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => void (await vi.waitFor(() => expect(host.querySelector("nav li")).not.toBeNull())));
  return { host, unmount: () => act(() => root.unmount()) };
}

const button = (host: HTMLElement, text: string | RegExp) => [...host.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.getAttribute("aria-label") ?? b.textContent ?? ""))) as HTMLButtonElement | undefined;

describe("deleting from the history", () => {
  it("offers it on a finished underwriting, not on one that is still working", async () => {
    const { host, unmount } = await mount("/underwriting");
    expect(host.querySelectorAll('button[aria-label^="Delete "]')).toHaveLength(1);
    const working = [...host.querySelectorAll("nav li")].find((li) => li.textContent?.includes("BTK r3"))!;
    expect(working.querySelector("button")).toBeNull();
    unmount();
  });

  it("asks first, naming the versions that go with it, and Cancel changes nothing", async () => {
    const { host, unmount } = await mount("/underwriting");
    await act(async () => button(host, /^Delete Multiple sclerosis/)!.click());
    const ask = host.querySelector('[role="group"][aria-label="Confirm deletion"]')!;
    expect(ask.textContent).toContain("Delete this underwriting and its 1 corrected version?");
    expect(document.activeElement).toBe(button(host, "Cancel"));
    await act(async () => button(host, "Cancel")!.click());
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(calls).toEqual([]);
    unmount();
  });

  it("deletes the whole group on confirmation and drops it from the list", async () => {
    const { host, unmount } = await mount("/underwriting");
    await act(async () => button(host, /^Delete Multiple sclerosis/)!.click());
    await act(async () => button(host, "Delete")!.click());
    await act(async () => void (await vi.waitFor(() => expect(host.textContent).not.toContain("BTK r1"))));
    expect(calls).toEqual(["DELETE /api/runs/r1"]);
    expect(host.querySelector('[role="group"]')).toBeNull();
    unmount();
  });

  it("leaves the page for a new underwriting when it deleted the one being shown", async () => {
    const { host, unmount } = await mount("/underwriting/runs/r2");
    await act(async () => button(host, /^Delete Multiple sclerosis/)!.click());
    await act(async () => button(host, "Delete")!.click());
    await act(async () => void (await vi.waitFor(() => expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/underwriting"))));
    unmount();
  });

  it("says why when the server refuses, and keeps the row", async () => {
    refuse = new Response(JSON.stringify({ error: { code: "run_active", message: "a run that is still working cannot be deleted", details: [] } }), { status: 409 });
    const { host, unmount } = await mount("/underwriting");
    await act(async () => button(host, /^Delete Multiple sclerosis/)!.click());
    await act(async () => button(host, "Delete")!.click());
    await act(async () => void (await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull())));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("still working");
    expect(host.textContent).toContain("BTK r1");
    unmount();
  });
});
