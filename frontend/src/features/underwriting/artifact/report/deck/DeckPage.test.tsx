import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { DeckScript, UnderwritingReport } from "../../../../../api/types";
import DeckPage from "./DeckPage";
import { createDeckPdf, saveFile } from "./deckPdf";

vi.mock("./deckPdf", () => ({ createDeckPdf: vi.fn(), saveFile: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = reportJson as unknown as UnderwritingReport;
const claim = Object.values(report.claims).find((c) => c.status === "accepted")!;
const script: DeckScript = {
  subtitle: "A tagline from the model",
  slides: [{ slide: "call", headline: "The model's headline for the call", bullets: [{ text: "A cited point.", stance: "for", claim_ids: [claim.id], evidence_ids: [] }], takeaway: "The model's so-what." }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubApi(deck: () => Response | Promise<Response>) {
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/deck") || url.includes("/deck?")) {
        posts.push(`${init?.method} ${url}`);
        return deck();
      }
      return json({ summary: { id: "r1", status: "completed" }, nodes: [], report });
    }),
  );
  return posts;
}

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/underwriting/runs/r1/deck"]}>
          <Routes>
            <Route path="/underwriting/runs/:runId/deck" element={<DeckPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return { host, unmount: () => act(() => root.unmount()) };
}

const until = (check: () => boolean) => act(async () => void (await vi.waitFor(() => expect(check()).toBe(true), { timeout: 3000 })));

beforeEach(() => {
  // jsdom has no layout: the page only needs something that can be observed
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(createDeckPdf).mockReset();
  vi.mocked(saveFile).mockReset();
});

const pdfButton = (host: HTMLElement) => [...host.querySelectorAll("header button")].find((b) => /PDF/.test(b.textContent ?? "")) as HTMLButtonElement;

describe("the deck page", () => {
  it("waits for the model's words, then shows the slides with them and says who wrote what", async () => {
    const posts = stubApi(() => json(script));
    const { host, unmount } = mount();
    await until(() => host.textContent?.includes("The model's headline for the call") ?? false);
    expect(posts).toEqual(["POST /api/runs/r1/deck"]);
    expect(host.querySelectorAll(".deck-frame")).toHaveLength(12);
    expect(host.textContent).toContain("words by the model, figures from the report");
    expect(host.textContent).toContain("The model's so-what.");
    expect(host.textContent).toContain("A tagline from the model");
    expect(host.textContent).not.toContain("Writing the committee deck");
    unmount();
  });

  it("shows no slides while the words are being written, so nothing jumps when they arrive", async () => {
    let release: (r: Response) => void = () => {};
    stubApi(() => new Promise<Response>((resolve) => (release = resolve)));
    const { host, unmount } = mount();
    await until(() => host.textContent?.includes("Writing the committee deck") ?? false);
    expect(host.querySelectorAll(".deck-frame")).toHaveLength(0);
    expect((host.querySelector("header button:last-of-type") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release(json(script)));
    await until(() => host.querySelectorAll(".deck-frame").length === 12);
    unmount();
  });

  it("falls back to the report's own wording, and says the model could not be reached, when the call fails", async () => {
    stubApi(() => json({ error: { code: "x", message: "down", details: [] } }, 502));
    const { host, unmount } = mount();
    await until(() => host.querySelectorAll(".deck-frame").length === 12);
    expect(host.textContent).toContain("in the report's own wording");
    expect(host.textContent).toContain("The model could not be reached.");
    expect(host.textContent).not.toContain("The model's headline");
    unmount();
  });

  it("writes the words again when asked, and swaps them in", async () => {
    const second: DeckScript = { ...script, slides: [{ ...script.slides[0]!, headline: "A rewritten headline" }] };
    let calls = 0;
    const posts = stubApi(() => json(++calls === 1 ? script : second));
    const { host, unmount } = mount();
    await until(() => host.textContent?.includes("The model's headline for the call") ?? false);
    const rewrite = [...host.querySelectorAll("header button")].find((b) => b.textContent === "Rewrite") as HTMLButtonElement;
    await act(async () => rewrite.click());
    await until(() => host.textContent?.includes("A rewritten headline") ?? false);
    expect(posts).toEqual(["POST /api/runs/r1/deck", "POST /api/runs/r1/deck?rewrite=true"]);
    expect(host.textContent).not.toContain("The model's headline for the call");
    unmount();
  });

  it("creates the PDF from the slides on screen, shows its progress, and saves it under the program's name", async () => {
    stubApi(() => json(script));
    let finish: (file: Blob) => void = () => {};
    vi.mocked(createDeckPdf).mockImplementation((slides, onProgress) => {
      onProgress?.(3, slides.length);
      return new Promise<Blob>((resolve) => (finish = resolve));
    });
    const { host, unmount } = mount();
    await until(() => host.querySelectorAll(".deck-frame").length === 12);
    expect(pdfButton(host).textContent).toBe("Download PDF");
    await act(async () => pdfButton(host).click());
    expect(vi.mocked(createDeckPdf).mock.calls[0]![0]).toHaveLength(12);
    expect(pdfButton(host).textContent).toBe("Creating the PDF… 3 of 12");
    expect(pdfButton(host).disabled).toBe(true);
    const file = new Blob(["%PDF"]);
    await act(async () => finish(file));
    expect(saveFile).toHaveBeenCalledWith(file, `Unobio underwriting - ${report.program.mechanism} in ${report.program.indication} - committee deck.pdf`);
    expect(pdfButton(host).textContent).toBe("Download PDF");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    unmount();
  });

  it("says so, and lets the reader try again, when the browser cannot draw the slides", async () => {
    stubApi(() => json(script));
    vi.mocked(createDeckPdf).mockRejectedValue(new Error("canvas is too large"));
    const { host, unmount } = mount();
    await until(() => host.querySelectorAll(".deck-frame").length === 12);
    await act(async () => pdfButton(host).click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not create the PDF: canvas is too large.");
    expect(saveFile).not.toHaveBeenCalled();
    expect(pdfButton(host).disabled).toBe(false);
    unmount();
  });
});
