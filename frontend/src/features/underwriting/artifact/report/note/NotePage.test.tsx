import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../../api/types";
import NotePage from "./NotePage";
import { buildNote } from "./noteDoc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = reportJson as unknown as UnderwritingReport;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mount(detail: unknown = { summary: { id: "r1", status: "completed" }, nodes: [], report }) {
  vi.stubGlobal("fetch", vi.fn(async () => json(detail)));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/underwriting/runs/r1/note"]}>
          <Routes>
            <Route path="/underwriting/runs/:runId/note" element={<NotePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return { host, unmount: () => act(() => root.unmount()) };
}
const until = (check: () => boolean) => act(async () => void (await vi.waitFor(() => expect(check()).toBe(true), { timeout: 3000 })));

let scrolled: string[];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the note page", () => {
  it("shows the report as a note: properties, a title, headings of different levels, the quotes and the sources", async () => {
    const { host, unmount } = mount();
    await until(() => host.querySelector("main h1") !== null);
    expect(host.querySelector("main h1")!.textContent).toBe("BACE1 inhibition in Alzheimer's disease");
    expect([...host.querySelectorAll("main h2")].map((h) => h.textContent)).toEqual(expect.arrayContaining(["Verdict", "The numbers behind it", "Sources"]));
    expect(host.querySelectorAll("main h3").length).toBeGreaterThan(3);
    expect(host.querySelectorAll("main h4").length).toBeGreaterThan(0);
    expect(host.querySelector('section[aria-label="Properties"]')!.textContent).toContain("Conditional");
    expect(host.querySelector('section[aria-label="Properties"]')!.textContent).toContain("#bace1-inhibition");
    expect(host.querySelectorAll("main blockquote").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("main table").length).toBe(2);
    expect(host.querySelectorAll("li[id^='src-']").length).toBe(buildNote(report).sources.length);
    expect(host.textContent).toContain("Synthetic data.");
    expect(host.querySelector('a[href="/underwriting/runs/r1"]')!.textContent).toContain("Back to the report");
    unmount();
  });

  it("sizes headings the way Obsidian does: each level smaller than the one above", async () => {
    const { host, unmount } = mount();
    await until(() => host.querySelector("main h1") !== null);
    const size = (tag: string) => host.querySelector(`main ${tag}`)!.className;
    expect(size("h1")).toContain("text-[2em]");
    expect(size("h2")).toContain("text-[1.6em]");
    expect(size("h3")).toContain("text-[1.37em]");
    expect(size("h4")).toContain("text-[1.25em]");
    unmount();
  });

  it("scrolls to the source when a citation is clicked, and to a heading from the outline", async () => {
    const { host, unmount } = mount();
    await until(() => host.querySelector("sup a") !== null);
    const ref = host.querySelector("sup a") as HTMLAnchorElement;
    await act(async () => ref.click());
    expect(scrolled).toEqual([`src-${ref.textContent}`]);
    const outline = [...host.querySelectorAll('aside[aria-label="Outline"] a')].find((a) => a.textContent === "The numbers behind it") as HTMLAnchorElement;
    await act(async () => outline.click());
    expect(scrolled.at(-1)).toBe("the-numbers-behind-it");
    unmount();
  });

  it("copies the note's Markdown", async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    const { host, unmount } = mount();
    await until(() => host.querySelector("main h1") !== null);
    const button = [...host.querySelectorAll("header button")].find((b) => b.textContent === "Copy Markdown") as HTMLButtonElement;
    await act(async () => button.click());
    expect(write).toHaveBeenCalledWith(buildNote(report).markdown);
    expect(button.textContent).toBe("Copied");
    unmount();
  });

  it("says so when the run has no report yet", async () => {
    const { host, unmount } = mount({ summary: { id: "r1", status: "running" }, nodes: [], report: null });
    await until(() => host.textContent?.includes("no report yet") ?? false);
    expect(host.querySelector("main")).toBeNull();
    unmount();
  });
});
