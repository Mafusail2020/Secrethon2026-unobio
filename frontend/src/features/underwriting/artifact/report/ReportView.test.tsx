import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { GraphSpec, UnderwritingReport } from "../../../../api/types";
import { ReportView } from "./ReportView";

const spec = graphSpecJson as GraphSpec;
const fixture = reportJson as unknown as UnderwritingReport;
const scrubbed = JSON.parse(JSON.stringify(fixture).replaceAll("FIXTURE:", "Real:")) as UnderwritingReport;
const clean: UnderwritingReport = { ...scrubbed, meta: { ...scrubbed.meta, synthetic: false } };

const render = (report: UnderwritingReport, canCorrect = true, focusClaim?: { id: string; nonce: number }) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ReportView report={report} runId="r1" graph={spec} canCorrect={canCorrect} focusClaim={focusClaim} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("report on the BACE1 fixture", () => {
  const markup = render(fixture);

  it("has the navigator and the export buttons in one row, and no synthetic-data banner", () => {
    expect(markup).not.toContain("Synthetic data");
    const header = markup.slice(markup.indexOf("<header"), markup.indexOf("</header>"));
    expect(header.indexOf("Report sections")).toBeGreaterThan(-1);
    expect(header.indexOf("Generate report")).toBeGreaterThan(header.indexOf("Report sections"));
    expect(header.match(/<(nav|div) /g)!.length).toBeLessThanOrEqual(4);
    for (const label of ["Summary", "Works", "Approval", "Uptake", "Funding", "Numbers", "Full report", "Clinical plan", "All claims (16)"]) expect(markup).toContain(label);
  });

  it("opens with the call and the four questions, every branch closed", () => {
    expect(markup).toContain("Probability of success");
    expect(markup).toContain("What carries it");
    expect(markup).toContain("What holds it back");
    for (const title of ["Will it work in people?", "Will it get through trials and regulators?", "Will it actually be used?", "Is funding it to the next milestone worth it?"]) {
      expect(markup).toContain(title);
    }
    expect(markup).toContain("Expand all");
    expect(markup.match(/aria-expanded="false"/g)!.length).toBeGreaterThanOrEqual(5);
    expect(markup).not.toContain('data-open="true"');
  });

  it("makes each reason on the call a link to its claim, with no separate button", () => {
    expect(markup).not.toMatch(/>why</);
    expect(markup).toMatch(/<button[^>]*title="Show the claim behind this"[^>]*>FIXTURE: prior programs were terminated<\/button>/);
  });

  it("shows the efficacy and safety checks with their numbers inside their questions", () => {
    expect(markup).toContain("Efficacy check");
    expect(markup).toContain("Safety check");
    expect(markup).toContain("Could not check:");
  });

  it("opens the branch a claim link points at", () => {
    const some = Object.values(fixture.claims).find((c) => c.section === "safety" && c.status === "accepted")!;
    const opened = render(fixture, true, { id: some.id, nonce: 1 });
    expect(opened).toMatch(/id="q-body-approval" data-open="true"/);
    expect(opened).not.toMatch(/id="q-body-works" data-open="true"/);
    expect(opened).toContain(`id="tree-claim-${some.id}"`);
  });

  it("shows the quant visuals and their honest warnings", () => {
    expect(markup).toContain("Evidence ledger");
    expect(markup).toContain("Thin history: with only 2 similar programs");
    expect(markup).toContain("Funding to the next milestone");
    expect(markup).toContain("Will it work in humans? The translation chain");
  });

  it("states plainly when a section has not enough public evidence", () => {
    expect(markup).toContain("Not enough public evidence");
  });

  it("keeps rejected and downgraded claims visible", () => {
    expect(markup).toContain("rejected");
    expect(markup).toContain("downgraded");
  });

  it("offers the correction shortcut only when corrections are possible", () => {
    expect(render(fixture, true)).not.toMatch(/disabled=""[^>]*>This is wrong/);
    expect(render(fixture, false)).toMatch(/disabled=""[^>]*title="Corrections open once the run has completed"[^>]*>This is wrong|This is wrong<\/button>/);
  });
});

describe("report on messy data", () => {
  it("renders a sparse report without the quant parts", () => {
    const sparse: UnderwritingReport = {
      ...clean,
      twin_stats: null,
      ledger: null,
      valuation: null,
      translation_chain: [],
      key_risks: [],
      critical_unknowns: [],
      diligence_questions: [],
      sections: {},
      claims: {},
      evidence: {},
      sources: {},
    };
    const markup = render(sparse);
    expect(markup).toContain("Historical twin statistics are not available for this run.");
    expect(markup).toContain("No evidence ledger was produced");
    expect(markup).toContain("No valuation was produced for this run.");
    expect(markup).toContain("All claims (0)");
    expect(markup).not.toContain("Synthetic data");
  });

  it("warns about a degraded run", () => {
    const degraded = { ...clean, meta: { ...clean.meta, failed_nodes: ["fetch_literature"] } };
    expect(render(degraded)).toContain("Degraded run: fetch_literature did not complete");
  });

  it("shows a model panel with its agreement and disagreements", () => {
    const section = clean.sections.disease_need!;
    const withPanel: UnderwritingReport = {
      ...clean,
      sections: {
        ...clean.sections,
        disease_need: {
          ...section,
          panel: {
            candidates: [
              { model: "a", summary: "first view", decision_hint: "invest" },
              { model: "b", summary: "second view", decision_hint: null },
            ],
            consensus: "they agree on need",
            disagreements: ["they differ on size"],
            agreement: 0.6,
          },
        },
      },
    };
    const markup = render(withPanel);
    expect(markup).toContain("Model panel (2 candidates)");
    expect(markup).toContain("Agreement 60%");
    expect(markup).toContain("they differ on size");
  });

  it("renders a report with many claims", () => {
    const base = Object.values(clean.claims)[0]!;
    const claims = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`c${i}`, { ...base, id: `c${i}`, text: `claim number ${i}` }]));
    const markup = render({ ...clean, claims });
    expect(markup).toContain("All claims (200)");
    expect(markup).toContain("claim number 199");
  });
});

describe("printing", () => {
  it("marks the page as a report to print while the report is on screen, and only then", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    expect(document.body.dataset.print).toBeUndefined();
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <ReportView report={clean} runId="r1" graph={spec} canCorrect />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    expect(document.body.dataset.print).toBe("report");
    act(() => root.unmount());
    expect(document.body.dataset.print).toBeUndefined();
  });
});
