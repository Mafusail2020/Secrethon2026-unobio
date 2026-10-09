import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { DeckScript, UnderwritingReport } from "../../../../../api/types";
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

describe("buildDeck with a model's script", () => {
  const claim = Object.values(real.claims).find((c) => c.status === "accepted" && c.stance === "con" && c.evidence_ids.length > 0)!;
  const pro = Object.values(real.claims).find((c) => c.status === "accepted" && c.stance === "pro")!;
  const script: DeckScript = {
    subtitle: "A tagline for the program",
    slides: [
      {
        slide: "call",
        headline: "The call rests on one plausible link",
        bullets: [
          { text: "The target is linked to the disease.", stance: "for", claim_ids: [pro.id], evidence_ids: [] },
          { text: "A late-stage twin failed.", stance: "against", claim_ids: [claim.id], evidence_ids: [] },
        ],
        takeaway: "Settle human target engagement first.",
      },
      {
        slide: "works",
        headline: "Biology is plausible, the human link is not shown",
        bullets: [{ text: "Only against bullets here.", stance: "against", claim_ids: [claim.id], evidence_ids: [] }],
        takeaway: null,
      },
      {
        slide: "probability",
        headline: "Evidence moved the odds down from the starting point",
        bullets: [{ text: "The chance is lower than where similar programs start.", stance: "neutral", claim_ids: [], evidence_ids: [] }],
        takeaway: "The range is wide.",
      },
      { slide: "money", headline: "Funding is modest next to the value", bullets: [], takeaway: null },
    ],
  };
  const plain = buildDeck(real);
  const written = buildDeck(real, script);
  const slide = (id: string) => written.slides.find((s) => s.id === id)!;

  it("changes nothing when there is no script, an empty one, or none worth showing", () => {
    expect(plain.scripted).toBe(false);
    expect(buildDeck(real, { subtitle: null, slides: [] })).toEqual(plain);
    expect(buildDeck(real, undefined)).toEqual(plain);
  });

  it("puts the model's headline on each slide it wrote, keeps the topic, and leaves the others alone", () => {
    expect(written.scripted).toBe(true);
    expect(slide("call")).toMatchObject({ actionTitle: "The call rests on one plausible link", title: "Our call", takeaway: "Settle human target engagement first." });
    expect(slide("probability").actionTitle).toBe("Evidence moved the odds down from the starting point");
    expect(slide("q-approval").actionTitle).toBeUndefined();
    expect(slide("q-approval")).toEqual(plain.slides.find((s) => s.id === "q-approval"));
  });

  it("uses its bullets for the side they argue and keeps the report's own claims for a side it left empty", () => {
    const call = slide("call");
    if (call.kind !== "call") throw new Error("not the call");
    expect(call.carries.map((l) => l.text)).toEqual(["The target is linked to the disease."]);
    expect(call.holds.map((l) => l.text)).toEqual(["A late-stage twin failed."]);
    const works = slide("q-works");
    const before = plain.slides.find((s) => s.id === "q-works");
    if (works.kind !== "question" || before?.kind !== "question") throw new Error("not a question");
    expect(works.cons.map((l) => l.text)).toEqual(["Only against bullets here."]);
    expect(works.pros).toEqual(before.pros);
  });

  it("gives each line the label of the claim it cites and the sources behind it", () => {
    const call = slide("call");
    if (call.kind !== "call") throw new Error("not the call");
    expect(call.holds[0]).toMatchObject({ claimId: claim.id, label: claim.label });
    expect(call.holds[0]!.cites.length).toBeGreaterThan(0);
    expect(call.sources.length).toBeGreaterThan(0);
  });

  it("puts what the figures mean under the numeric slides, and keeps the figures", () => {
    const money = slide("funding");
    expect(money.actionTitle).toBe("Funding is modest next to the value");
    expect(money.reading).toEqual([]);
    const probability = slide("probability");
    expect(probability.reading?.[0]).toMatchObject({ text: "The chance is lower than where similar programs start.", cites: [] });
    const before = plain.slides.find((s) => s.id === "probability");
    if (probability.kind !== "probability" || before?.kind !== "probability") throw new Error("not probability");
    expect(probability.posterior).toEqual(before.posterior);
    expect(probability.steps).toEqual(before.steps);
    const call = slide("call");
    const callBefore = plain.slides.find((s) => s.id === "call");
    if (call.kind !== "call" || callBefore?.kind !== "call") throw new Error("not the call");
    expect([call.pos, call.rnpv, call.decision]).toEqual([callBefore.pos, callBefore.rnpv, callBefore.decision]);
  });

  it("gives the title slide its subtitle", () => {
    const title = slide("title");
    expect(title.kind === "title" && title.subtitle).toBe("A tagline for the program");
  });

  it("names the uploaded file behind a bullet that cites a passage of it", () => {
    const withFile = structuredClone(real);
    const [id, source] = Object.entries(withFile.sources)[0]!;
    withFile.sources[id] = { ...source, type: "user_provided", title: "User document: study.pdf", identifiers: { document: "doc_0123456789abcdef" } };
    const deck = buildDeck(withFile, {
      subtitle: null,
      slides: [{ slide: "twins", headline: "The file adds a mouse result", bullets: [{ text: "The mouse study shows a drop.", stance: "neutral", claim_ids: [], evidence_ids: ["ev_0123456789abcdef"] }], takeaway: null }],
    });
    const twins = deck.slides.find((s) => s.id === "twins")!;
    expect(twins.reading?.[0]?.cites).toEqual(["study.pdf"]);
    expect(twins.sources).toContain("study.pdf");
  });
});
