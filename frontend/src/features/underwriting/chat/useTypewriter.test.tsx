import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { typedCounts, useTypewriter } from "./useTypewriter";
import { Welcome } from "./Welcome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = () => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <Welcome />
    </MemoryRouter>
  </QueryClientProvider>
);

const parts = [
  { text: "abcd", speed: 100 },
  { text: "wxyz", speed: 100 },
  { text: "0123456789", speed: 10 },
];

describe("typedCounts", () => {
  it("types the parts in turn, one character per its speed", () => {
    expect(typedCounts(0, parts, 0)).toEqual([0, 0, 0]);
    expect(typedCounts(250, parts, 0)).toEqual([2, 0, 0]);
    expect(typedCounts(400, parts, 0)).toEqual([4, 0, 0]);
    expect(typedCounts(650, parts, 0)).toEqual([4, 2, 0]);
  });

  it("waits a beat before a part that types at a different pace, and finishes every part", () => {
    expect(typedCounts(800, parts, 300)).toEqual([4, 4, 0]);
    expect(typedCounts(1000, parts, 300)).toEqual([4, 4, 0]);
    expect(typedCounts(1150, parts, 300)).toEqual([4, 4, 5]);
    expect(typedCounts(60_000, parts, 300)).toEqual([4, 4, 10]);
  });
});

describe("Welcome", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is laid out in full before anything is typed, and reads whole to a screen reader", () => {
    const markup = renderToStaticMarkup(page());
    expect(markup).toContain('<span class="sr-only">Underwrite a drug program</span>');
    expect(markup).toContain("Tell me about your drug program. I research public evidence");
    // nothing visible yet, everything reserved
    expect(markup).toContain('<span class="invisible">Underwrite a </span>');
    expect(markup).toContain("uw-caret");
  });

  it("types the greeting out and then stops, leaving the whole text and no caret", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(page()));
    const heading = () => host.querySelector("h2 > span[aria-hidden]")?.textContent;
    expect(heading()).toBe("Underwrite a ");
    await act(async () => void vi.advanceTimersByTime(500));
    const partway = host.querySelector("h2")!.textContent!.replace("Underwrite a drug program", "");
    expect(partway.length).toBeGreaterThan(0);
    expect(host.querySelector(".uw-caret")).not.toBeNull();
    await act(async () => void vi.advanceTimersByTime(8000));
    expect(host.querySelector(".invisible")?.textContent).toBe("");
    expect(host.querySelector(".uw-caret")).toBeNull();
    expect(host.querySelector("p")!.textContent).toContain("traceable to its sources.");
    act(() => root.unmount());
  });

  it("shows everything at once when the reader prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Probe() {
      const { counts, done } = useTypewriter(parts);
      return <i data-done={String(done)}>{counts.join(",")}</i>;
    }
    act(() => root.render(<Probe />));
    expect(host.querySelector("i")!.textContent).toBe("4,4,10");
    expect(host.querySelector("i")!.getAttribute("data-done")).toBe("true");
    act(() => root.unmount());
  });
});
