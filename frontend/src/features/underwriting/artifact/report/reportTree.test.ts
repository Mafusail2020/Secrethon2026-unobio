import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { Claim, UnderwritingReport } from "../../../../api/types";
import { buildReportTree, claimWeight, firstSentence, questionOfClaim, QUESTIONS } from "./reportTree";

const report = reportJson as unknown as UnderwritingReport;
const claim = (over: Partial<Claim>): Claim => ({
  id: "c",
  text: "t",
  section: "scientific_thesis",
  stance: "pro",
  label: "extracted",
  evidence_ids: [],
  confidence: "high",
  produced_by: "x",
  status: "accepted",
  rejection_reason: null,
  ...over,
});
const withClaims = (list: Claim[], extra: Partial<UnderwritingReport> = {}): UnderwritingReport => ({
  ...report,
  claims: Object.fromEntries(list.map((c) => [c.id, c])),
  ...extra,
});

describe("claimWeight", () => {
  it("counts confidence, halves a downgrade and ignores a rejection", () => {
    expect(claimWeight(claim({ confidence: "high" }))).toBe(3);
    expect(claimWeight(claim({ confidence: "low" }))).toBe(1);
    expect(claimWeight(claim({ confidence: "high", status: "downgraded" }))).toBe(1.5);
    expect(claimWeight(claim({ status: "rejected" }))).toBe(0);
  });
});

describe("the tree on the BACE1 fixture", () => {
  const tree = buildReportTree(report);

  it("has the four questions in the order an investor asks them", () => {
    expect(tree.questions.map((q) => q.id)).toEqual(["works", "approval", "uptake", "funding"]);
    expect(QUESTIONS.map((q) => q.title)).toEqual(tree.questions.map((q) => q.title));
  });

  it("places every claim exactly once, and keeps rejected ones out of the weighing", () => {
    const all = Object.values(report.claims);
    const seen = tree.questions.flatMap((q) => [...q.pros, ...q.cons, ...q.neutral, ...q.rejected]).concat(tree.unplaced);
    expect(seen.map((c) => c.id).sort()).toEqual(all.map((c) => c.id).sort());
    for (const q of tree.questions) for (const c of [...q.pros, ...q.cons, ...q.neutral]) expect(c.status).not.toBe("rejected");
    expect(tree.questions.flatMap((q) => q.rejected).every((c) => c.status === "rejected")).toBe(true);
  });

  it("puts pros on the pro side, cons on the con side, heaviest first", () => {
    for (const q of tree.questions) {
      expect(q.pros.every((c) => c.stance === "pro")).toBe(true);
      expect(q.cons.every((c) => c.stance === "con")).toBe(true);
      const weights = q.cons.map(claimWeight);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
    }
  });

  it("splits the probability's movement between the questions and loses none of it", () => {
    const total = tree.questions.reduce((sum, q) => sum + (q.impact?.pts ?? 0), 0);
    expect(total).toBeCloseTo((report.pos.base - report.ledger!.prior.base) * 100, 6);
    expect(tree.questions.find((q) => q.id === "approval")!.impact!.pts).toBeLessThan(0);
  });

  it("rates a question from its check when there is one, and says why", () => {
    const works = tree.questions.find((q) => q.id === "works")!;
    const approval = tree.questions.find((q) => q.id === "approval")!;
    expect(works.standing).toBe("unfavourable");
    expect(works.basis).toContain("efficacy check");
    expect(approval.standing).toBe("unfavourable");
    expect(works.headline).toBe(report.assessments.find((a) => a.cause === "efficacy")!.headline);
  });

  it("finds the branch a claim sits in, for links that jump to it", () => {
    const some = tree.questions.find((q) => q.cons.length)!.cons[0]!;
    expect(questionOfClaim(tree, some.id)).toBeDefined();
    expect(questionOfClaim(tree, "nope")).toBeUndefined();
  });
});

describe("standing without a check", () => {
  const noChecks = (list: Claim[]) => buildReportTree(withClaims(list, { assessments: [] })).questions.find((q) => q.id === "uptake")!;
  const mk = (n: number, stance: Claim["stance"], over: Partial<Claim> = {}) =>
    Array.from({ length: n }, (_, i) => claim({ id: `${stance}${i}${over.confidence ?? ""}`, section: "competition", stance, ...over }));

  it("is unknown with nothing to weigh", () => {
    expect(noChecks([]).standing).toBe("unknown");
    expect(noChecks(mk(2, "neutral")).standing).toBe("unknown");
  });

  it("follows the weighted lean", () => {
    expect(noChecks(mk(3, "pro")).standing).toBe("favourable");
    expect(noChecks(mk(3, "con")).standing).toBe("unfavourable");
    expect(noChecks([...mk(2, "pro"), ...mk(2, "con")]).standing).toBe("mixed");
    // a confident con outweighs a shaky pro
    expect(noChecks([...mk(1, "pro", { confidence: "low" }), ...mk(1, "con", { confidence: "high" })]).standing).toBe("unfavourable");
  });
});

describe("risk claims", () => {
  it("go to the question their risk is about, and to nowhere when no risk names them", () => {
    const risky = claim({ id: "r1", section: "risks", stance: "con" });
    const orphan = claim({ id: "r2", section: "risks", stance: "con" });
    const rep = withClaims([risky, orphan], {
      key_risks: [{ text: "liver tox", category: "safety", severity: "high", claim_ids: ["r1"] }],
    });
    const tree = buildReportTree(rep);
    expect(tree.questions.find((q) => q.id === "approval")!.cons.map((c) => c.id)).toEqual(["r1"]);
    expect(tree.unplaced.map((c) => c.id)).toEqual(["r2"]);
  });
});

describe("firstSentence", () => {
  it("takes the first sentence and cuts a long one at a word", () => {
    expect(firstSentence("It works. It really does.")).toBe("It works.");
    expect(firstSentence("one two three four five six seven eight nine ten", 20)).toBe("one two three four…");
    expect(firstSentence("   ")).toBe("");
  });
});
