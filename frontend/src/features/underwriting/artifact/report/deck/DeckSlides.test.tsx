import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../../api/types";
import { ExportBar } from "../ExportBar";
import { buildDeck } from "./deckModel";
import { DeckSlides } from "./DeckSlides";
import { SYNTHETIC_WARNING } from "./SlideFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = reportJson as unknown as UnderwritingReport;
const scrubbed = JSON.parse(JSON.stringify(fixture).replaceAll("FIXTURE:", "Real:")) as UnderwritingReport;
const real: UnderwritingReport = { ...scrubbed, meta: { ...scrubbed.meta, synthetic: false } };

const draw = (report: UnderwritingReport) => renderToStaticMarkup(<DeckSlides deck={buildDeck(report)} kicker="Unobio underwriting" />);
const count = (text: string, part: string) => text.split(part).length - 1;

describe("the deck on screen", () => {
  it("lays out every slide as a full-size landscape page, numbered", () => {
    const markup = draw(real);
    expect(count(markup, 'class="deck-slide')).toBe(12);
    expect(count(markup, "width:1280px;height:720px")).toBeGreaterThanOrEqual(12);
    expect(markup).toContain("Slide 1 of 12");
    expect(markup).toContain("Slide 12 of 12: Our recommendation");
    expect(markup.indexOf("Our recommendation")).toBeGreaterThan(markup.indexOf("Key risks and what we do not know"));
  });

  it("warns on every slide, and only, when the data is synthetic", () => {
    expect(count(draw(fixture), SYNTHETIC_WARNING)).toBe(12);
    expect(draw(real)).not.toContain("Synthetic data");
  });

  it("shows the answer to each of the four questions, with the sources behind the claims", () => {
    const markup = draw(real);
    for (const title of ["Will it work in people?", "Will it get through trials and regulators?", "Will it actually be used?", "Is funding it to the next milestone worth it?"]) {
      expect(markup).toContain(title);
    }
    expect(markup).toContain("Sources: ");
    expect(markup).toContain("ClinicalTrials.gov");
  });

  it("says what is missing instead of leaving a slide empty", () => {
    const markup = draw({ ...real, ledger: null, twin_stats: null, valuation: null });
    expect(markup).toContain("No evidence ledger was produced");
    expect(markup).toContain("No history of similar programs");
    expect(markup).toContain("No valuation was produced");
  });
});

describe("the Generate report menu", () => {
  const mount = () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <ExportBar report={real} />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    return { host, root };
  };

  it("is one button that opens a menu with the deck first, and closes on Escape", () => {
    const { host, root } = mount();
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("Generate report");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const items = [...host.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent ?? "");
    expect(items[0]).toContain("Investment committee deck");
    expect(items.some((t) => t.includes("Full report (PDF)"))).toBe(true);
    expect(items.some((t) => t.includes("Copy as Markdown"))).toBe(true);
    expect(host.querySelector('[role="menuitem"]')!.getAttribute("href")).toBe(`/underwriting/runs/${real.run_id}/deck`);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    act(() => root.unmount());
  });
});
