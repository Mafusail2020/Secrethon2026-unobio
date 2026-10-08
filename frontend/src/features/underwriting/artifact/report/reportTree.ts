import type { Claim, LedgerStep, Risk, SectionId, SectionResult, UnderwritingReport, Verdict } from "../../../../api/types";

/** The four things an investor asks of a drug program; every claim in the report answers one of them. */
export type QuestionId = "works" | "approval" | "uptake" | "funding";

/** Where one question stands: favourable, mixed, unfavourable, or not enough evidence to say. */
export type Standing = "favourable" | "mixed" | "unfavourable" | "unknown";

type Assessment = UnderwritingReport["assessments"][number];
type ReasonCode = Verdict["reason_codes"][number];

interface QuestionDef {
  id: QuestionId;
  title: string;
  /** a word or two for the navigator */
  short: string;
  /** the question as an investor would say it, for the card's subtitle */
  ask: string;
  sections: SectionId[];
  /** which failure causes of the ledger move this question's answer */
  causes: LedgerStep["cause"][];
  risks: Risk["category"][];
  assessment?: Assessment["cause"];
}

export const QUESTIONS: readonly QuestionDef[] = [
  {
    id: "works",
    title: "Will it work in people?",
    short: "Works",
    ask: "Does hitting this target change the disease in a human body?",
    sections: ["scientific_thesis", "translation"],
    causes: ["efficacy", "pk_exposure"],
    risks: ["efficacy", "pk_exposure"],
    assessment: "efficacy",
  },
  {
    id: "approval",
    title: "Will it get through trials and regulators?",
    short: "Approval",
    ask: "Is it safe enough, and is there a believable path to approval?",
    sections: ["safety", "clinical_plan"],
    causes: ["safety"],
    risks: ["safety", "regulatory", "cmc"],
    assessment: "safety",
  },
  {
    id: "uptake",
    title: "Will it actually be used?",
    short: "Uptake",
    ask: "Is the need real, and does it beat what patients get today?",
    sections: ["disease_need", "competition", "commercial_adoption"],
    causes: ["commercial"],
    risks: ["commercial", "ip"],
  },
  {
    id: "funding",
    title: "Is funding it to the next milestone worth it?",
    short: "Funding",
    ask: "Is the capital needed justified by the value it unlocks?",
    sections: ["capital"],
    causes: ["other"],
    risks: [],
  },
];

const CONFIDENCE_WEIGHT: Record<Claim["confidence"], number> = { high: 3, medium: 2, low: 1 };

/** How much a claim counts: its confidence, halved when the gate downgraded it, nothing when it was rejected. */
export function claimWeight(claim: Claim): number {
  if (claim.status === "rejected") return 0;
  return CONFIDENCE_WEIGHT[claim.confidence] * (claim.status === "downgraded" ? 0.5 : 1);
}

export interface QuestionImpact {
  /** percentage points the evidence for this question moved the probability of success, from the ledger */
  pts: number;
  steps: { factor: string; pts: number }[];
}

export interface QuestionNode {
  id: QuestionId;
  title: string;
  short: string;
  ask: string;
  standing: Standing;
  /** why the standing is what it is, in a few words a reader can check against the claims */
  basis: string;
  headline: string;
  pros: Claim[];
  cons: Claim[];
  neutral: Claim[];
  /** claims the gate rejected: kept out of the weighing, still listed under the full report */
  rejected: Claim[];
  balance: { pro: number; con: number };
  sections: SectionResult[];
  risks: Risk[];
  unknowns: string[];
  assessment?: Assessment;
  impact: QuestionImpact | null;
}

export interface ReportTree {
  questions: QuestionNode[];
  /** claims that belong to no question, e.g. a risk claim no risk points at */
  unplaced: Claim[];
  reasons: { positive: ReasonCode[]; negative: ReasonCode[] };
  /** the question that moved the probability down the most, when the ledger says */
  biggestDrag: QuestionNode | undefined;
}

const RATING_STANDING: Record<Assessment["rating"], Standing> = {
  strong: "favourable",
  moderate: "mixed",
  weak: "unfavourable",
  concerning: "unfavourable",
  unknown: "unknown",
};

/** First sentence of a summary, cut at a word boundary, for a card that must fit on one line or two. */
export function firstSentence(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? clean.slice(0, end + 1) : clean;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : max)}…`;
}

function standingFromBalance(pro: number, con: number): { standing: Standing; basis: string } {
  const total = pro + con;
  if (total === 0) return { standing: "unknown", basis: "no claims either way" };
  const lean = (pro - con) / total;
  if (lean >= 0.4) return { standing: "favourable", basis: "the weighted claims lean for it" };
  if (lean <= -0.4) return { standing: "unfavourable", basis: "the weighted claims lean against it" };
  return { standing: "mixed", basis: "the weighted claims are split" };
}

function impactOf(report: UnderwritingReport, causes: LedgerStep["cause"][]): QuestionImpact | null {
  const ledger = report.ledger;
  if (!ledger) return null;
  let previous = ledger.prior.base;
  const steps: QuestionImpact["steps"] = [];
  for (const step of ledger.steps) {
    const pts = (step.pos_after.base - previous) * 100;
    previous = step.pos_after.base;
    if (causes.includes(step.cause)) steps.push({ factor: step.factor, pts });
  }
  return { pts: steps.reduce((sum, s) => sum + s.pts, 0), steps };
}

/**
 * The report as the tree a reader walks: the call at the root, the four questions under it, and under each its
 * claims for and against. Everything is derived from what the report already holds; nothing is added.
 */
export function buildReportTree(report: UnderwritingReport): ReportTree {
  const claims = Object.values(report.claims);
  const questionOfSection = new Map<SectionId, QuestionId>(QUESTIONS.flatMap((q) => q.sections.map((s) => [s, q.id] as const)));
  const questionOfCategory = new Map<Risk["category"], QuestionId>(QUESTIONS.flatMap((q) => q.risks.map((c) => [c, q.id] as const)));

  // a risk claim sits in the "risks" section: it goes to the question its risk is about
  const riskOfClaim = new Map<string, Risk>();
  for (const risk of report.key_risks) for (const id of risk.claim_ids) if (!riskOfClaim.has(id)) riskOfClaim.set(id, risk);
  const placeOf = (claim: Claim): QuestionId | undefined => {
    const direct = questionOfSection.get(claim.section);
    if (direct) return direct;
    const risk = riskOfClaim.get(claim.id);
    return risk ? questionOfCategory.get(risk.category) : undefined;
  };

  const placed = new Map<QuestionId, Claim[]>(QUESTIONS.map((q) => [q.id, []]));
  const unplaced: Claim[] = [];
  for (const claim of claims) {
    const at = placeOf(claim);
    if (at) placed.get(at)!.push(claim);
    else unplaced.push(claim);
  }
  const byWeight = (a: Claim, b: Claim) => claimWeight(b) - claimWeight(a);

  const questions = QUESTIONS.map((q): QuestionNode => {
    const mine = placed.get(q.id)!;
    const live = mine.filter((c) => c.status !== "rejected");
    const pros = live.filter((c) => c.stance === "pro").sort(byWeight);
    const cons = live.filter((c) => c.stance === "con").sort(byWeight);
    const balance = {
      pro: pros.reduce((sum, c) => sum + claimWeight(c), 0),
      con: cons.reduce((sum, c) => sum + claimWeight(c), 0),
    };
    const sections = q.sections.flatMap((id) => (report.sections[id] ? [report.sections[id]] : []));
    const assessment = q.assessment ? report.assessments.find((a) => a.cause === q.assessment) : undefined;
    const fromAssessment = assessment && assessment.rating !== "unknown" ? RATING_STANDING[assessment.rating] : undefined;
    const fromBalance = standingFromBalance(balance.pro, balance.con);
    const lead = sections.find((s) => s.summary.trim() && s.status !== "insufficient_evidence");
    return {
      id: q.id,
      title: q.title,
      short: q.short,
      ask: q.ask,
      standing: fromAssessment ?? fromBalance.standing,
      basis: fromAssessment ? `the ${assessment!.cause} check rates it ${assessment!.rating}` : fromBalance.basis,
      headline: assessment?.headline || (lead ? firstSentence(lead.summary) : "Public evidence did not answer this."),
      pros,
      cons,
      neutral: live.filter((c) => c.stance === "neutral").sort(byWeight),
      rejected: mine.filter((c) => c.status === "rejected"),
      balance,
      sections,
      risks: report.key_risks.filter((r) => q.risks.includes(r.category)),
      unknowns: sections.flatMap((s) => s.unknowns),
      assessment,
      impact: impactOf(report, q.causes),
    };
  });

  const drag = questions
    .filter((q) => q.impact && q.impact.pts < 0)
    .sort((a, b) => a.impact!.pts - b.impact!.pts)[0];

  return {
    questions,
    unplaced,
    reasons: {
      positive: report.verdict.reason_codes.filter((r) => r.direction === "positive"),
      negative: report.verdict.reason_codes.filter((r) => r.direction !== "positive"),
    },
    biggestDrag: drag,
  };
}

export const STANDING_LABEL: Record<Standing, string> = {
  favourable: "Favourable",
  mixed: "Mixed",
  unfavourable: "Unfavourable",
  unknown: "Not enough evidence",
};

/** The question a claim sits under, so a link to a claim can open the right branch. */
export function questionOfClaim(tree: ReportTree, claimId: string): QuestionId | undefined {
  return tree.questions.find((q) => [...q.pros, ...q.cons, ...q.neutral].some((c) => c.id === claimId))?.id;
}
