import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec } from "../../../../api/types";
import { OutputView } from "./NodeDrawer";
import { plainOutput } from "./plainOutput";

const spec = graphSpecJson as unknown as GraphSpec;
const range = (low: number, base: number, high: number) => ({ low, base, high, unit: "probability" });

describe("a step's output in plain words", () => {
  it("says a claim writer wrote nothing, which is what the raw tree hid under 'list of 0'", () => {
    const out = { scratch: { bull_claim_writer: { claims: [], quotes: {}, evidence_ids: ["ev_1", "ev_2", "ev_3", "ev_4"] } } };
    const plain = plainOutput("bull_claim_writer", out)!;
    expect(plain.headline).toBe("Drafted no claims");
    expect(plain.points).toEqual(["Read 4 evidence items", "No claim came out of this evidence, so nothing from it reaches the report."]);
  });

  it("counts what the server cut: five shown and 'n more' is n + 5", () => {
    const questions = [1, 2, 3, 4, 5].map((i) => ({ id: `q${i}`, section: "translation", question: `Question ${i}?` }));
    const plain = plainOutput("question_planner", { questions: [...questions, "… 1 more"] })!;
    expect(plain.headline).toBe("Planned 6 questions to answer");
    expect(plain.points[0]).toBe("Translation: Question 1?");
    expect(plain.points.at(-1)).toBe("… and 1 more");
  });

  it("tells what a gate kept, downgraded and rejected, and why", () => {
    const claim = (status: string, why: string | null = null) => ({ id: "c", text: "t", status, rejection_reason: why });
    const out = { claims: { a: claim("accepted"), b: claim("downgraded", "quote not found verbatim in the cited evidence"), c: claim("accepted"), d: claim("rejected", "cited evidence id does not exist") } };
    const plain = plainOutput("bull_claim_gate", out)!;
    expect(plain.headline).toBe("Checked 4 claims against their evidence: 2 kept, 1 downgraded, 1 rejected");
    expect(plain.points).toEqual(expect.arrayContaining(["Why a claim was not kept as it was: quote not found verbatim in the cited evidence", "Why a claim was not kept as it was: cited evidence id does not exist"]));
  });

  it("walks the ledger: from the prior to the posterior, each piece of evidence as points gained or lost", () => {
    const step = (factor: string, base: number) => ({ factor, cause: "efficacy", pos_after: range(base - 0.05, base, base + 0.05) });
    const out = { ledger: { prior: range(0.08, 0.14, 0.2), posterior: range(0.03, 0.11, 0.19), steps: [step("same-target programs terminated for efficacy elsewhere", 0.12), step("known target safety liabilities", 0.11)] } };
    const plain = plainOutput("evidence_ledger", out)!;
    expect(plain.headline).toBe("The chance of success went from 14.0% (from 8.0% to 20.0%) to 11.0% (from 3.0% to 19.0%)");
    expect(plain.points).toEqual(["same-target programs terminated for efficacy elsewhere: down 2.0 points", "known target safety liabilities: down 1.0 points"]);
  });

  it("describes what a fetch found, with the step's own facts", () => {
    const trials = plainOutput("fetch_trials", { scratch: { fetch_trials: { statuses: { COMPLETED: 2, ACTIVE_NOT_RECRUITING: 1 }, stopped: [] } }, source_ids: ["s1", "s2", "s3"], evidence_ids: ["e1", "e2", "e3", "e4", "e5", "… 1 more"] })!;
    expect(trials.headline).toBe("Found 3 sources and 6 evidence items in ClinicalTrials.gov");
    expect(trials.points).toEqual(["Trials found: 2 completed, 1 active not recruiting"]);
    const targets = plainOutput("fetch_opentargets", { scratch: { fetch_opentargets: { association_score: 0.2987, genetic_association: null, target_drugs: 24 } }, source_ids: [], evidence_ids: [] })!;
    expect(targets.headline).toBe("Found nothing new in Open Targets");
    expect(targets.points).toEqual(["Target–disease association score 0.30 out of 1", "No human genetic association found", "24 drugs act on this target"]);
  });

  it("gives the verdict, the money and the similar programs in sentences", () => {
    expect(plainOutput("verdict", { verdict: { decision: "conditional", confidence: "medium", rationale: "Conditional: PoS 10.6%", reason_codes: [{ text: "0 of 15 comparable programs reached approval" }], conditions: ["a", "b"] } })).toEqual({
      headline: "Conditional, with medium confidence",
      points: ["Conditional: PoS 10.6%", "Reason: 0 of 15 comparable programs reached approval", "2 conditions to clear before funding"],
    });
    const money = plainOutput("valuation", { valuation: { next_milestone: "Phase 1 readout", capital_to_milestone: { low: 5e6, base: 13e6, high: 28e6 }, time_to_milestone_months: { low: 12, base: 18, high: 24 }, rnpv: { low: -84e6, base: 9e6, high: 847e6 } } })!;
    expect(money.headline).toBe("Getting to Phase 1 readout needs about $13.0M");
    expect(money.points[2]).toContain("Risk-adjusted value: $9.0M");
    const twins = plainOutput("twin_stats", { twin_stats: { match_level: "target_area", n_programs: 162, prior_pos: range(0.0762, 0.1336, 0.2021), stage_distribution: { PHASE_2: 74, PHASE_1: 21, PHASE_3: 36 }, stop_reasons: { Negative: 14, Business_Administrative: 6 } } })!;
    expect(twins.headline).toBe("Matched 162 similar programs (target area match)");
    expect(twins.points).toEqual(["Starting chance of success from their record: 13.4% (from 7.6% to 20.2%)", "Furthest stage they reached, most common first: phase 2 (74), phase 3 (36), phase 1 (21)", "Why the stopped ones stopped: negative (14), business administrative (6)"]);
  });

  it("knows nothing of a step it has no words for, and never throws on an odd output", () => {
    expect(plainOutput("some_new_step", { x: 1 })).toBeUndefined();
    for (const node of spec.nodes) {
      for (const out of [{}, { scratch: 3, claims: "x", ledger: [], verdict: null, valuation: { rnpv: 1 }, assessments: [1] }]) {
        expect(() => plainOutput(node.id, out as Record<string, unknown>), node.id).not.toThrow();
      }
    }
  });
});

describe("the output tab", () => {
  it("leads with the plain words and keeps the data itself under 'Raw data'", () => {
    const markup = renderToStaticMarkup(<OutputView nodeId="bull_claim_writer" output={{ scratch: { bull_claim_writer: { claims: [], quotes: {}, evidence_ids: ["ev_1"] } } }} />);
    expect(markup.indexOf("Drafted no claims")).toBeGreaterThan(-1);
    expect(markup.indexOf("Raw data")).toBeGreaterThan(markup.indexOf("Drafted no claims"));
    expect(markup).toContain("<details");
  });

  it("shows only the data for a step it cannot put in words", () => {
    const markup = renderToStaticMarkup(<OutputView nodeId="some_new_step" output={{ x: 1 }} />);
    expect(markup).not.toContain("Raw data");
    expect(markup).toContain("x: ");
  });
});
