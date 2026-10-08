import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { GraphSpec, UnderwritingReport } from "../../../../api/types";
import { ReportView } from "./ReportView";

const spec = graphSpecJson as GraphSpec;
const fixture = reportJson as unknown as UnderwritingReport;
const scrubbed = JSON.parse(JSON.stringify(fixture).replaceAll("FIXTURE:", "Real:")) as UnderwritingReport;
const clean: UnderwritingReport = { ...scrubbed, meta: { ...scrubbed.meta, synthetic: false } };

const render = (report: UnderwritingReport, canCorrect = true) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ReportView report={report} runId="r1" graph={spec} canCorrect={canCorrect} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("report on the BACE1 fixture", () => {
  const markup = render(fixture);

  it("carries the synthetic banner and the navigator", () => {
    expect(markup).toContain("Synthetic data: this report contains placeholder content");
    for (const label of ["Overview", "Translation chain", "Clinical plan", "All claims (16)", "Run"]) expect(markup).toContain(label);
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
