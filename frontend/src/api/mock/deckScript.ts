import { pct } from "../../lib/format";
import type { DeckBullet, DeckScript, SectionId, SlideScript, UnderwritingReport } from "../types";

const SECTIONS: Record<string, SectionId[]> = {
  works: ["scientific_thesis", "translation"],
  approval: ["safety", "clinical_plan"],
  uptake: ["disease_need", "competition", "commercial_adoption"],
  funding: ["capital"],
};

/** A script like the model's, built from the report, so the mock UI shows the deck as it looks with one. All text is synthetic. */
export function mockDeckScript(report: UnderwritingReport): DeckScript {
  const claims = Object.values(report.claims).filter((c) => c.status !== "rejected");
  const bullet = (text: string, claimIds: string[], stance: DeckBullet["stance"] = "neutral"): DeckBullet => ({
    text: `FIXTURE: ${text}`,
    stance,
    claim_ids: claimIds,
    evidence_ids: [],
  });
  const slide = (id: SlideScript["slide"], headline: string, bullets: DeckBullet[], takeaway?: string): SlideScript => ({
    slide: id,
    headline: `FIXTURE: ${headline}`,
    bullets,
    takeaway: takeaway ? `FIXTURE: ${takeaway}` : null,
  });
  const side = (ids: SectionId[]) => {
    const mine = claims.filter((c) => ids.includes(c.section));
    const pick = (stance: "pro" | "con", out: DeckBullet["stance"]) =>
      mine.filter((c) => c.stance === stance).slice(0, 2).map((c) => bullet(c.text.replace(/^FIXTURE: /, ""), [c.id], out));
    return [...pick("pro", "for"), ...pick("con", "against")];
  };
  const { verdict, ledger, twin_stats: twins, valuation } = report;
  const grounded = claims.filter((c) => c.label === "extracted" || c.label === "derived").length;
  const any = claims.slice(0, 3).map((c) => c.id);
  const out: SlideScript[] = [
    slide("call", "The call rests on a plausible target and two unproven links", [
      ...claims.filter((c) => c.stance === "pro").slice(0, 2).map((c) => bullet(c.text.replace(/^FIXTURE: /, ""), [c.id], "for")),
      ...claims.filter((c) => c.stance === "con").slice(0, 3).map((c) => bullet(c.text.replace(/^FIXTURE: /, ""), [c.id], "against")),
    ], "the decision holds only if human target engagement is shown"),
    slide("works", "The biology is plausible, the human link is not shown", side(SECTIONS.works!), "efficacy is the question to settle first"),
    slide("approval", "A recorded safety liability makes approval the harder path", side(SECTIONS.approval!), "safety is the second-biggest drag on the odds"),
    slide("uptake", "Need is high, but adoption cannot be judged from public data", side(SECTIONS.uptake!), "pricing and payer views are the open questions"),
    slide("funding", "Funding to the next milestone is a modeled range, not a quote", side(SECTIONS.funding!), "treat the capital figure as a starting point"),
  ].filter((s) => s.bullets.length > 0 || s.slide === "funding");
  out.push(
    slide("probability", "Evidence moved the chance down from where similar programs start", [
      bullet(`the chance of success is ${pct(report.pos.base)}, from a starting point of ${ledger ? pct(ledger.prior.base) : "the base rate"}`, []),
      bullet("each step below shows what one piece of evidence added or took away", []),
    ], "no single step decides it; the range is wide"),
    slide("twins", "Similar programs give a thin starting point", [bullet(`${twins?.n_programs ?? 0} similar programs were found, so the prior is weak`, [])]),
    slide("money", "Funding to the milestone is modest against the value it unlocks", valuation ? [
      bullet("the report models capital, time and value as ranges; the base case is shown first", []),
      bullet("what would move the value is the first human readout", []),
    ] : [], "the downside is bounded by the capital to the milestone"),
    slide("evidence", "About half of the claims rest on a source or a calculation", [
      bullet(`${grounded} of ${claims.length} counted claims are extracted or derived`, []),
      bullet("hypotheses and unknowns are listed, not hidden", []),
    ]),
    slide("risks", "Efficacy and safety are the risks that matter", report.key_risks.slice(0, 3).map((r) => bullet(r.text.replace(/^FIXTURE: /, ""), r.claim_ids.filter((id) => id in report.claims)))
      .filter((b) => b.claim_ids.length > 0)),
    slide("recommendation", `${verdict.decision.replace(/_/g, " ")}: proceed only on the conditions below`, [
      bullet("the call is conditional at low confidence", any),
      ...verdict.conditions.slice(0, 2).map((c) => bullet(c.replace(/^FIXTURE: /, ""), [])),
    ], "ask for the target-engagement data before funding"),
  );
  return {
    subtitle: `FIXTURE: ${report.program.mechanism} in ${report.program.indication}, ${verdict.decision.replace(/_/g, " ")}`,
    slides: out.filter((s) => s.bullets.length > 0 || ["funding", "money", "twins"].includes(s.slide)),
  };
}
