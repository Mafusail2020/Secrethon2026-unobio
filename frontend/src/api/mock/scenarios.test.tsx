import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import eventsRaw from "../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../contracts/fixtures/graph_spec.json";
import reportJson from "../../../../contracts/fixtures/report_bace1_alzheimers.json";
import { ReportView } from "../../features/underwriting/artifact/report/ReportView";
import type { GraphSpec, RunEvent, UnderwritingReport } from "../types";
import { adjustDrafts, adjustReport, scenarioFromSearch, stepDelayFactor, type Draft } from "./scenarios";

const spec = graphSpecJson as GraphSpec;
const fixture = reportJson as unknown as UnderwritingReport;
const drafts: Draft[] = eventsRaw
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as RunEvent)
  .map(({ type, node_id, data }) => ({ type, node_id, data }));
const render = (report: UnderwritingReport) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ReportView report={report} runId="r" graph={spec} canCorrect />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("mock scenarios", () => {
  it("reads the scenario from the url and ignores anything else", () => {
    expect(scenarioFromSearch("?scenario=sparse")).toBe("sparse");
    expect(scenarioFromSearch("?scenario=nope")).toBeUndefined();
    expect(scenarioFromSearch("")).toBeUndefined();
    expect(stepDelayFactor("slow")).toBeGreaterThan(1);
    expect(stepDelayFactor()).toBe(1);
  });

  it("failed: stops at the planner with a critical failure and a failed run", () => {
    const out = adjustDrafts(drafts, "failed");
    expect(out.at(-2)).toMatchObject({ type: "node.failed", node_id: "question_planner" });
    expect(out.at(-1)!.type).toBe("run.failed");
    expect(out.some((d) => d.type === "run.completed")).toBe(false);
  });

  it("sparse: one non-critical fetch fails and the run still completes", () => {
    const out = adjustDrafts(drafts, "sparse");
    expect(out.filter((d) => d.type === "node.failed").map((d) => d.node_id)).toEqual(["fetch_literature"]);
    expect(out.at(-1)!.type).toBe("run.completed");
  });

  it("leaves a normal run alone", () => {
    expect(adjustDrafts(drafts)).toEqual(drafts);
  });

  it("sparse report renders without the quant parts and says so", () => {
    const markup = render(adjustReport(structuredClone(fixture), "sparse"));
    expect(markup).toContain("Historical twin statistics are not available");
    expect(markup).toContain("Degraded run: fetch_literature");
    expect(markup).toContain("Not enough public evidence");
  });

  it("large report keeps every claim reachable", () => {
    const report = adjustReport(structuredClone(fixture), "large");
    expect(Object.keys(report.claims)).toHaveLength(Object.keys(fixture.claims).length + 150);
    const markup = render(report);
    expect(markup).toContain("All claims (166)");
    expect(markup).toContain("bulk claim 149");
  });
});
