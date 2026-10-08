import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { Claim, GraphSpec, ReportDiff, UnderwritingReport } from "../../../../api/types";
import { emptyFilters, facetCounts, filterClaims, isFiltering, toggleValue } from "./claimFilters";
import { correctionTargetFor } from "./correctionTarget";
import { buildDiffView } from "./diffView";
import { toMarkdown } from "./markdown";
import { isSyntheticReport } from "./synthetic";
import { groupStopReasons, hasGuessedGroups, sortStages, stopGroupOf } from "./twinView";
import { buildWaterfall } from "./waterfall";

const report = reportJson as unknown as UnderwritingReport;
const spec = graphSpecJson as GraphSpec;
const claims = Object.values(report.claims);

describe("claim filters", () => {
  it("treats an empty facet as any and combines facets with AND", () => {
    expect(filterClaims(claims, emptyFilters)).toHaveLength(claims.length);
    const con = filterClaims(claims, { ...emptyFilters, stance: new Set(["con"]) });
    expect(con.length).toBeGreaterThan(0);
    expect(con.every((c) => c.stance === "con")).toBe(true);
    const conExtracted = filterClaims(claims, { ...emptyFilters, stance: new Set(["con"]), label: new Set(["extracted"]) });
    expect(conExtracted.every((c) => c.stance === "con" && c.label === "extracted")).toBe(true);
  });

  it("filters by status and confidence", () => {
    const rejected = filterClaims(claims, { ...emptyFilters, status: new Set(["rejected"]) });
    expect(rejected.map((c) => c.status)).toEqual(["rejected"]);
    const high = filterClaims(claims, { ...emptyFilters, confidence: new Set(["high"]) });
    expect(high.every((c) => c.confidence === "high")).toBe(true);
  });

  it("searches claim text, rejection reasons and evidence quotes, ignoring case", () => {
    expect(filterClaims(claims, { ...emptyFilters, query: "TERMINATED" }, report).length).toBeGreaterThan(0);
    expect(filterClaims(claims, { ...emptyFilters, query: "does not exist in this run" }, report)).toHaveLength(1);
    expect(filterClaims(claims, { ...emptyFilters, query: "overallStatus" }, report).length).toBeGreaterThan(0);
    expect(filterClaims(claims, { ...emptyFilters, query: "no such phrase anywhere" }, report)).toEqual([]);
  });

  it("counts facets and toggles values immutably", () => {
    const counts = facetCounts(claims, "stance");
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(claims.length);
    const set = new Set<string>(["a"]);
    expect([...toggleValue(set, "b")]).toEqual(["a", "b"]);
    expect([...toggleValue(set, "a")]).toEqual([]);
    expect([...set]).toEqual(["a"]);
    expect(isFiltering(emptyFilters)).toBe(false);
    expect(isFiltering({ ...emptyFilters, query: " x " })).toBe(true);
  });
});

describe("diff view", () => {
  const diff: ReportDiff = {
    from_run: "a",
    to_run: "b",
    decision_before: "conditional",
    decision_after: "do_not_invest",
    pos_before: { low: 0.01, base: 0.04, high: 0.09, unit: "probability" },
    pos_after: { low: 0.01, base: 0.03, high: 0.08, unit: "probability" },
    changed_sections: ["clinical_plan"],
    added_claim_ids: ["new"],
    removed_claim_ids: [claims[0]!.id],
    recomputed_nodes: ["verdict"],
  };

  it("resolves claim text from the right report and keeps unknown ids", () => {
    const after = { ...report, claims: { new: { ...claims[1]!, id: "new", text: "added claim" } } } as UnderwritingReport;
    const view = buildDiffView(diff, report, after);
    expect(view.decisionChanged).toBe(true);
    expect(view.posDelta).toBeCloseTo(-0.01);
    expect(view.added.map((c) => c.text)).toEqual(["added claim"]);
    expect(view.removed.map((c) => c.id)).toEqual([claims[0]!.id]);
    expect(view.sections).toEqual([{ id: "clinical_plan", title: "Clinical plan" }]);
    expect(buildDiffView(diff, undefined, undefined).added[0]!.text).toBe("new");
  });

  it("detects an unchanged re-run", () => {
    const same: ReportDiff = { ...diff, decision_after: "conditional", pos_after: diff.pos_before, changed_sections: [], added_claim_ids: [], removed_claim_ids: [] };
    expect(buildDiffView(same, report, report).unchanged).toBe(true);
    expect(buildDiffView(diff, report, report).unchanged).toBe(false);
  });
});

describe("waterfall", () => {
  const ledger = report.ledger!;

  it("chains the base ratios from the prior and keeps the posterior from the data", () => {
    const w = buildWaterfall(ledger);
    expect(w.steps).toHaveLength(ledger.steps.length);
    expect(w.steps[0]!.start).toBeCloseTo(ledger.prior.base);
    expect(w.steps[1]!.start).toBeCloseTo(w.steps[0]!.end);
    expect(w.posterior).toBe(ledger.posterior);
    expect(w.chainedEnd).toBeCloseTo(w.steps.at(-1)!.end);
  });

  it("moves down for ratios under one and up for ratios over one, with whiskers around the end", () => {
    for (const s of buildWaterfall(ledger).steps) {
      expect(s.end < s.start).toBe(s.step.direction === "down");
      expect(s.lowEnd).toBeLessThanOrEqual(s.end + 1e-9);
      expect(s.highEnd).toBeGreaterThanOrEqual(s.end - 1e-9);
    }
  });

  it("flags a chain that disagrees with the posterior and stays quiet when they agree", () => {
    expect(buildWaterfall({ ...ledger, posterior: { low: 0.3, base: 0.3, high: 0.4, unit: "probability" } }).driftNotable).toBe(true);
    const w = buildWaterfall(ledger);
    expect(buildWaterfall({ ...ledger, posterior: { ...ledger.posterior, base: w.chainedEnd } }).driftNotable).toBe(false);
    expect(w.axisMax).toBeLessThanOrEqual(1);
  });

  it("handles a ledger with no steps", () => {
    const w = buildWaterfall({ ...ledger, steps: [] });
    expect(w.steps).toEqual([]);
    expect(w.chainedEnd).toBeCloseTo(ledger.prior.base);
  });
});

describe("twin view", () => {
  it("groups free-text stop reasons by keyword and leaves the rest as other", () => {
    expect(stopGroupOf("Lack of efficacy")).toBe("efficacy");
    expect(stopGroupOf("Safety / side effects")).toBe("safety");
    expect(stopGroupOf("Insufficient enrollment")).toBe("business");
    expect(stopGroupOf("FIXTURE: reason not extracted")).toBe("other");
    const grouped = groupStopReasons({ "Lack of efficacy": 3, "Negative": 2, "Safety": 1, "Something else": 4 });
    expect(grouped.map((g) => [g.group, g.total])).toEqual([["efficacy", 5], ["safety", 1], ["other", 4]]);
    expect(grouped[0]!.items[0]!.reason).toBe("Lack of efficacy");
    expect(groupStopReasons({})).toEqual([]);
  });

  it("sorts stages from earliest to latest and unknown names last", () => {
    const sorted = sortStages({ "Phase 3": 1, Preclinical: 2, Approved: 1, "Phase 2": 4, "FIXTURE: late-stage": 1, Weird: 1 });
    expect(sorted.map((s) => s.stage)).toEqual(["Preclinical", "Phase 2", "FIXTURE: late-stage", "Phase 3", "Approved", "Weird"]);
  });
});

describe("synthetic guard", () => {
  it("trusts the flag and also catches leftover fixture text", () => {
    expect(isSyntheticReport(report)).toBe(true);
    const clean = JSON.parse(JSON.stringify(report).replaceAll("FIXTURE:", "x")) as UnderwritingReport;
    expect(isSyntheticReport({ ...clean, meta: { ...clean.meta, synthetic: false } })).toBe(false);
    expect(isSyntheticReport({ ...clean, meta: { ...clean.meta, synthetic: true } })).toBe(true);
    const leaked = { ...clean, meta: { ...clean.meta, synthetic: false }, critical_unknowns: ["FIXTURE: leftover"] };
    expect(isSyntheticReport(leaked)).toBe(true);
  });
});

describe("correction target", () => {
  const claim = (produced_by: string): Claim => ({ ...claims[0]!, produced_by });

  it("sends gate claims to their writer, which also recomputes the gate", () => {
    const target = correctionTargetFor(claim("bull_claim_gate"), spec)!;
    expect(target.node.id).toBe("bull_claim_writer");
    expect(target.note).toContain("re-checks drafts");
    expect(correctionTargetFor(claim("bear_claim_gate"), spec)!.node.id).toBe("bear_claim_writer");
  });

  it("uses the producer directly when it is correctable", () => {
    const target = correctionTargetFor(claim("section_analysts"), spec)!;
    expect(target.node.id).toBe("section_analysts");
    expect(target.note).toBeUndefined();
  });

  it("falls back upstream for a node that cannot be corrected, and explains", () => {
    const target = correctionTargetFor(claim("evidence_normalizer"), spec)!;
    expect(target.node.correctable).toBe(true);
    expect(target.node.id).not.toBe("evidence_normalizer");
    expect(target.note).toContain("cannot be corrected");
  });

  it("falls back to the analysts for a producer that is not in the graph", () => {
    const target = correctionTargetFor(claim("some_future_node"), spec)!;
    expect(target.node.id).toBe("section_analysts");
    expect(target.note).toContain("not a step in the graph");
  });
});

describe("markdown export", () => {
  const md = toMarkdown(report);

  it("leads with the verdict and flags synthetic data", () => {
    expect(md.startsWith("# BACE1 inhibition in Alzheimer's disease")).toBe(true);
    expect(md).toContain("**Verdict: Conditional**");
    expect(md).toContain("Synthetic data");
  });

  it("lists claims with their labels and links their sources", () => {
    expect(md).toContain("_[con, extracted, high confidence]_");
    expect(md).toContain("](https://clinicaltrials.gov/study/NCT01739348)");
    expect(md).toContain("rejected");
  });

  it("includes sections, questions and run details", () => {
    expect(md).toContain("## Clinical plan");
    expect(md).toContain("## Diligence questions");
    expect(md).toContain("## Run details");
    expect(md.endsWith("\n")).toBe(true);
  });
});

describe("backend-provided fields win over the browser's guesses", () => {
  const ledger = report.ledger!;

  it("draws the waterfall from pos_after when every step has it", () => {
    const w = buildWaterfall(ledger);
    expect(w.exact).toBe(true);
    expect(w.steps.at(-1)!.end).toBe(ledger.steps.at(-1)!.pos_after!.base);
    expect(w.steps[0]!.lowEnd).toBe(ledger.steps[0]!.pos_after!.low);
    expect(w.driftNotable).toBe(false);
  });

  it("falls back to chaining ratios when a step lacks pos_after", () => {
    const stripped = { ...ledger, steps: ledger.steps.map((s, i) => (i === 0 ? { ...s, pos_after: null } : s)) };
    const w = buildWaterfall(stripped);
    expect(w.exact).toBe(false);
    expect(w.steps[0]!.end).toBeCloseTo(ledger.steps[0]!.pos_after!.base, 3); // same maths, so the same picture
  });

  it("flags a ledger whose own steps do not reach its posterior", () => {
    const off = { ...ledger, posterior: { low: 0.2, base: 0.25, high: 0.3, unit: "probability" } };
    expect(buildWaterfall(off).driftNotable).toBe(true);
  });

  it("uses the source's stop-reason category and only guesses for the rest", () => {
    const reasons = { "Lack of efficacy": 2, "Odd wording": 1 };
    const grouped = groupStopReasons(reasons, { "Odd wording": "safety" });
    expect(grouped.map((g) => [g.group, g.total])).toEqual([["efficacy", 2], ["safety", 1]]);
    expect(hasGuessedGroups(reasons, { "Odd wording": "safety" })).toBe(true);
    expect(hasGuessedGroups(reasons, { "Odd wording": "safety", "Lack of efficacy": "efficacy" })).toBe(false);
    expect(hasGuessedGroups({}, {})).toBe(false);
  });

  it("routes a writer-authored claim straight to its writer", () => {
    const target = correctionTargetFor({ ...claims[0]!, produced_by: "bull_claim_writer" }, spec)!;
    expect(target.node.id).toBe("bull_claim_writer");
    expect(target.note).toBeUndefined();
  });
});
