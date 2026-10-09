import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassageChips } from "./PassageChips";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detail = (id: string, locator: string, excerpt: string) => ({
  evidence: { id, source_id: "src_1", excerpt, locator, entity_ids: [], kind: "text", data: null },
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
});

afterEach(() => vi.unstubAllGlobals());

function mount(ids: string[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <PassageChips ids={ids} />
      </QueryClientProvider>,
    ),
  );
  return { host, unmount: () => act(() => root.unmount()) };
}

const settle = (until: () => boolean) => act(async () => void (await vi.waitFor(() => expect(until()).toBe(true), { timeout: 2000 })));

describe("PassageChips", () => {
  it("names each passage by its file and page, and shows the quote when the chip is opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = url.split("/").pop()!;
        return new Response(JSON.stringify(detail(id, id === "ev_a" ? "p. 3" : "p. 7", `Quote from ${id}.`)), { status: 200 });
      }),
    );
    const { host, unmount } = mount(["ev_a", "ev_b"]);
    await settle(() => [...host.querySelectorAll("button")].every((b) => !b.textContent?.includes("Loading")));
    const chips = [...host.querySelectorAll("button")];
    expect(chips.map((c) => c.textContent)).toEqual(["BACE1 mouse study.pdf · p. 3", "BACE1 mouse study.pdf · p. 7"]);
    expect(host.querySelector("blockquote")).toBeNull();
    act(() => chips[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector("blockquote")?.textContent).toContain("Quote from ev_b.");
    expect(chips[1]!.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("blockquote a")?.getAttribute("href")).toBe("/api/documents/doc_0123456789abcdef/file#page=7");
    act(() => chips[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector("blockquote")).toBeNull();
    unmount();
  });

  it("draws nothing when the answer cites no passage, and a disabled chip when one cannot be found", async () => {
    expect(mount([]).host.textContent).toBe("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "evidence_not_found", message: "no", details: [] } }), { status: 404 })));
    const { host, unmount } = mount(["ev_gone"]);
    await settle(() => host.querySelector("button")?.textContent === "Passage");
    const chip = host.querySelector("button")!;
    expect(chip.textContent).toBe("Passage");
    expect(chip.hasAttribute("disabled")).toBe(true);
    unmount();
  });
});
