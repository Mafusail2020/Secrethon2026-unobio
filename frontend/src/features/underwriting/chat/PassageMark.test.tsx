import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownText } from "./MarkdownText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detail = {
  evidence: { id: "ev_a", source_id: "src_1", excerpt: "Brain Abeta42 fell 62 percent in mice.", locator: "p. 3", entity_ids: [], kind: "text", data: null },
  source: {
    id: "src_1",
    type: "user_provided",
    title: "User document: BACE1 mouse study.pdf",
    url: null,
    publisher: "user",
    published_at: null,
    retrieved_at: "2026-10-09T00:00:00Z",
    identifiers: { document: "doc_0123456789abcdef" },
  },
};

afterEach(() => vi.unstubAllGlobals());

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MarkdownText text="Mice responded [[ev_a]]." ids={[]} passageIds={["ev_a"]} report={undefined} onOpenClaim={() => {}} />
      </QueryClientProvider>,
    ),
  );
  return { host, unmount: () => act(() => root.unmount()) };
}

const settle = (until: () => boolean) => act(async () => void (await vi.waitFor(() => expect(until()).toBe(true), { timeout: 2000 })));

describe("a citation of a passage in the user's file", () => {
  it("is a numbered mark that opens the quote, with the file and the page, and closes on Escape", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { host, unmount } = mount();
    const mark = host.querySelector("sup button")!;
    expect(mark.textContent).toBe("1");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is fetched until the mark is opened
    act(() => mark.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle(() => !!host.querySelector('[role="dialog"]')?.textContent?.includes("Brain Abeta42"));
    const card = host.querySelector('[role="dialog"]')!;
    expect(card.textContent).toContain("BACE1 mouse study.pdf · p. 3");
    expect(card.textContent).toContain("Brain Abeta42 fell 62 percent in mice.");
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/api/documents/doc_0123456789abcdef/file");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    unmount();
  });

  it("closes when the reader clicks elsewhere, and says so when the passage cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "evidence_not_found", message: "no", details: [] } }), { status: 404 })));
    const { host, unmount } = mount();
    act(() => host.querySelector("sup button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle(() => !!host.querySelector('[role="dialog"]')?.textContent?.includes("could not be loaded"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("could not be loaded");
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    unmount();
  });
});
