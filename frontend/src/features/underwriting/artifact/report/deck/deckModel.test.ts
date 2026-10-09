import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../../api/types";
import { buildDeck, type DeckSlide, type QuestionSlide } from "./deckModel";

const fixture = reportJson as unknown as UnderwritingReport;
const scrubbed = JSON.parse(JSON.stringify(fixture).replaceAll("FIXTURE:", "Real:")) as UnderwritingReport;
const real: UnderwritingReport = { ...scrubbed, meta: { ...scrubbed.meta, synthetic: false } };
const sparse: UnderwritingReport = { ...real, ledger: null, twin_stats: null, valuation: null, translation_chain: [], assessments: [], key_risks: [], critical_unknowns: [] };

const kinds = (slides: DeckSlide[]) => slides.map((s) => s.kind);

describe("buildDeck", () => {
  const deck = buildDeck(real);

  it("is a dozen slides that open on the program and end on the recommendation", () => {
    expect(kinds(deck.slides)).toEqual([
      "title",
      "call",
      "question",
      "question",
      "question",
      "question",
      "probability",
      "twins",
      "funding",
      "evidence",
      "risks",
      "recommendation",
    ]);
    expect(deck.slides[0]).toMatchObject({ program: "BACE1 inhibition in Alzheimer's disease" });
    expect(new Set(deck.slides.map((s) => s.id)).size).toBe(deck.slides.length);
  });

  it("repeats the report's own numbers and decision, never its own", () => {
    const call = deck.slides.find((s) => s.kind === "call")!;
    const end = deck.slides.at(-1)!;
    expect(call).toMatchObject({ decision: real.verdict.decision, pos: real.pos, rnpv: real.valuation!.rnpv, capital: real.valuation!.capital_to_milestone });
    expect(end).toMatchObject({ kind: "recommendation", decision: real.verdict.decision, pos: real.pos, conditions: real.verdict.conditions });
  });

  it("puts only claims of the report on the question slides, and none the gate rejected", () => {
    const questions = deck.slides.filter((s): s is QuestionSlide => s.kind === "question");
    expect(questions.map((q) => q.question)).toEqual(["works", "approval", "uptake", "funding"]);
    const lines = questions.flatMap((q) => [...q.pros, ...q.cons]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const claim = real.claims[line.claimId];
      expect(claim, line.claimId).toBeDefined();
      expect(claim!.status).not.toBe("rejected");
      expect(line.label).toBe(claim!.label);
    }
    for (const q of questions) {
      expect(q.pros.length).toBeLessThanOrEqual(3);
      expect(q.cons.length).toBeLessThanOrEqual(3);
    }
  });

  it("names, in each footer, only sources the report holds", () => {
    const known = new Set(Object.values(real.sources).flatMap((s) => [s.title, s.publisher ?? ""]));
    for (const slide of deck.slides) {
      for (const name of slide.sources.filter((n) => !n.startsWith("and "))) expect(known.has(name) || slide.kind === "probability", `${slide.id}: ${name}`).toBe(true);
    }
    expect(deck.slides.find((s) => s.id === "q-works")!.sources.length).toBeGreaterThan(0);
  });

  it("orders the risks by severity and puts the most pressing diligence questions first", () => {
    const risks = deck.slides.find((s) => s.kind === "risks")!;
    if (risks.kind !== "risks") throw new Error("not risks");
    const order = ["high", "medium", "low"];
    const ranks = risks.risks.map((r) => order.indexOf(r.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const end = deck.slides.at(-1)!;
    if (end.kind !== "recommendation") throw new Error("not the recommendation");
    expect(end.questions[0]!.question).toBe(real.diligence_questions.find((d) => d.priority === 1)!.question);
  });

  it("carries the synthetic warning only when the report is synthetic", () => {
    expect(deck.synthetic).toBe(false);
    expect(buildDeck(fixture).synthetic).toBe(true);
    expect(buildDeck({ ...real, meta: { ...real.meta, synthetic: true } }).synthetic).toBe(true);
  });

  it("keeps all twelve slides when the report has no ledger, no twins and no valuation, and says so", () => {
    const thin = buildDeck(sparse);
    expect(thin.slides).toHaveLength(12);
    expect(thin.slides.find((s) => s.kind === "probability")).toMatchObject({ prior: null, steps: [], causes: [] });
    expect(thin.slides.find((s) => s.kind === "twins")).toMatchObject({ stats: null });
    expect(thin.slides.find((s) => s.kind === "funding")).toMatchObject({ valuation: null });
    expect(thin.slides.find((s) => s.kind === "call")).toMatchObject({ rnpv: null, capital: null, months: null });
  });
});
