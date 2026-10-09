import type { Claim, Decision, Range, Risk, UnderwritingReport } from "../../../../../api/types";
import { DECISION_LABEL, humanize } from "../../../../../lib/format";
import { causeRows, groundedShare, labelMix, sourceMix, type CauseRow, type LabelSlice } from "../charts/chartData";
import { buildReportTree, firstSentence, STANDING_LABEL, type QuestionId, type Standing } from "../reportTree";
import { isSyntheticReport } from "../synthetic";

/** One statement on a slide: the claim as the report wrote it, how it is labelled, and who said so. */
export interface DeckLine {
  claimId: string;
  text: string;
  label: Claim["label"];
  /** publishers of the sources behind it, most first; empty when the claim cites none */
  cites: string[];
}

interface Base {
  id: string;
  title: string;
  /** every source the slide's lines lean on, for the footer */
  sources: string[];
}

export interface TitleSlide extends Base {
  kind: "title";
  program: string;
  facts: string[];
  date: string;
}

export interface CallSlide extends Base {
  kind: "call";
  decision: Decision;
  decisionLabel: string;
  confidence: string;
  pos: Range;
  rnpv: Range | null;
  capital: Range | null;
  months: Range | null;
  rationale: string;
  carries: DeckLine[];
  holds: DeckLine[];
}

export interface QuestionSlide extends Base {
  kind: "question";
  question: QuestionId;
  ask: string;
  standing: Standing;
  standingLabel: string;
  basis: string;
  headline: string;
  pros: DeckLine[];
  cons: DeckLine[];
  unknowns: string[];
  /** points the evidence on this question moved the chance, from the ledger */
  impactPts: number | null;
}

export interface ProbabilitySlide extends Base {
  kind: "probability";
  prior: Range | null;
  posterior: Range;
  steps: { factor: string; cause: string; pts: number }[];
  causes: CauseRow[];
}

export interface TwinsSlide extends Base {
  kind: "twins";
  stats: null | {
    matchLevel: string;
    count: number;
    prior: Range;
    stopReasons: { reason: string; count: number }[];
    programs: { drug: string; disease: string; stage: string; status: string }[];
  };
}

export interface FundingSlide extends Base {
  kind: "funding";
  valuation: null | {
    milestone: string;
    capital: Range;
    months: Range;
    rnpv: Range;
    inflections: string[];
    assumptions: { name: string; value: string; basis: string }[];
  };
}

export interface EvidenceSlide extends Base {
  kind: "evidence";
  mix: LabelSlice[];
  grounded: number;
  sourceKinds: { label: string; value: number }[];
  counts: { counted: number; downgraded: number; rejected: number; sources: number; evidence: number };
}

export interface RisksSlide extends Base {
  kind: "risks";
  risks: { category: string; severity: Risk["severity"]; text: string }[];
  unknowns: string[];
}

export interface RecommendationSlide extends Base {
  kind: "recommendation";
  decision: Decision;
  decisionLabel: string;
  confidence: string;
  pos: Range;
  rationale: string;
  conditions: string[];
  questions: { question: string; why: string }[];
  footnote: string;
}

export type DeckSlide = TitleSlide | CallSlide | QuestionSlide | ProbabilitySlide | TwinsSlide | FundingSlide | EvidenceSlide | RisksSlide | RecommendationSlide;

export interface Deck {
  slides: DeckSlide[];
  /** the data behind it is placeholder content, so every slide has to say so */
  synthetic: boolean;
}

const MAX_LINES = 3;
const MAX_SOURCES = 6;
const SEVERITY_ORDER: Risk["severity"][] = ["high", "medium", "low"];

function sourceName(report: UnderwritingReport, evidenceId: string): string | undefined {
  const source = report.sources[report.evidence[evidenceId]?.source_id ?? ""];
  return source ? source.publisher || source.title : undefined;
}

function lineOf(report: UnderwritingReport, claim: Claim): DeckLine {
  const names = claim.evidence_ids.flatMap((id) => sourceName(report, id) ?? []);
  return { claimId: claim.id, text: firstSentence(claim.text, 190), label: claim.label, cites: [...new Set(names)] };
}

function footer(lines: DeckLine[]): string[] {
  const all = [...new Set(lines.flatMap((l) => l.cites))];
  return all.length > MAX_SOURCES ? [...all.slice(0, MAX_SOURCES), `and ${all.length - MAX_SOURCES} more`] : all;
}

function reasonLines(report: UnderwritingReport, direction: "positive" | "negative"): DeckLine[] {
  return report.verdict.reason_codes
    .filter((r) => (direction === "positive") === (r.direction === "positive"))
    .map((r) => {
      const claim = report.claims[r.claim_ids[0] ?? ""];
      const cites = claim ? lineOf(report, claim).cites : [];
      return { claimId: r.claim_ids[0] ?? r.code, text: r.text, label: claim?.label ?? "unknown", cites };
    });
}

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function stepPoints(report: UnderwritingReport): ProbabilitySlide["steps"] {
  const ledger = report.ledger;
  if (!ledger) return [];
  let before = ledger.prior.base;
  return ledger.steps.map((s) => {
    const pts = (s.pos_after.base - before) * 100;
    before = s.pos_after.base;
    return { factor: s.factor, cause: humanize(s.cause), pts };
  });
}

/**
 * The investment-committee deck, written from the report alone: every number, claim and range is one the report
 * already holds, nothing is generated and nothing is rounded into a different claim.
 */
export function buildDeck(report: UnderwritingReport): Deck {
  const tree = buildReportTree(report);
  const { verdict, valuation, twin_stats: twins, ledger } = report;
  const synthetic = isSyntheticReport(report);
  const program = `${report.program.mechanism} in ${report.program.indication}`;
  const carries = reasonLines(report, "positive");
  const holds = reasonLines(report, "negative");
  const slides: DeckSlide[] = [];

  slides.push({
    kind: "title",
    id: "title",
    title: program,
    sources: [],
    program,
    facts: [
      ...(report.program.drug_name ? [report.program.drug_name] : []),
      ...(report.program.modality ? [humanize(report.program.modality)] : []),
      ...(report.program.stage ? [humanize(report.program.stage)] : []),
    ],
    date: dateOf(report.meta.created_at),
  });

  slides.push({
    kind: "call",
    id: "call",
    title: "Our call",
    sources: footer([...carries, ...holds]),
    decision: verdict.decision,
    decisionLabel: DECISION_LABEL[verdict.decision],
    confidence: verdict.confidence,
    pos: report.pos,
    rnpv: valuation?.rnpv ?? null,
    capital: valuation?.capital_to_milestone ?? null,
    months: valuation?.time_to_milestone_months ?? null,
    rationale: verdict.rationale,
    carries,
    holds,
  });

  for (const q of tree.questions) {
    const pros = q.pros.slice(0, MAX_LINES).map((c) => lineOf(report, c));
    const cons = q.cons.slice(0, MAX_LINES).map((c) => lineOf(report, c));
    slides.push({
      kind: "question",
      id: `q-${q.id}`,
      title: q.title,
      sources: footer([...pros, ...cons]),
      question: q.id,
      ask: q.ask,
      standing: q.standing,
      standingLabel: STANDING_LABEL[q.standing],
      basis: q.basis,
      headline: q.headline,
      pros,
      cons,
      unknowns: q.unknowns.slice(0, 3),
      impactPts: q.impact ? q.impact.pts : null,
    });
  }

  slides.push({
    kind: "probability",
    id: "probability",
    title: "How the chance of success was built",
    sources: ledger ? [...new Set(ledger.steps.flatMap((s) => (s.citation ? [s.citation] : [])))].slice(0, MAX_SOURCES) : [],
    prior: ledger?.prior ?? null,
    posterior: report.pos,
    steps: stepPoints(report),
    causes: ledger ? causeRows(ledger) : [],
  });

  slides.push({
    kind: "twins",
    id: "twins",
    title: "What happened to similar programs",
    sources: [],
    stats: twins
      ? {
          matchLevel: humanize(twins.match_level),
          count: twins.n_programs,
          prior: twins.prior_pos,
          stopReasons: Object.entries(twins.stop_reasons)
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 4),
          programs: twins.twins.slice(0, 5).map((t) => ({ drug: t.drug, disease: t.disease, stage: t.max_stage, status: t.status })),
        }
      : null,
  });

  slides.push({
    kind: "funding",
    id: "funding",
    title: "Funding to the next milestone",
    sources: [],
    valuation: valuation
      ? {
          milestone: valuation.next_milestone,
          capital: valuation.capital_to_milestone,
          months: valuation.time_to_milestone_months,
          rnpv: valuation.rnpv,
          inflections: valuation.value_inflection_points.slice(0, 4),
          assumptions: valuation.assumptions.slice(0, 5).map((a) => ({
            name: a.name,
            value: `${a.value.base} (${a.value.low} to ${a.value.high}) ${a.value.unit}`,
            basis: a.basis === "sourced" ? "sourced" : "assumption",
          })),
        }
      : null,
  });

  const claims = Object.values(report.claims);
  const mix = labelMix(claims);
  slides.push({
    kind: "evidence",
    id: "evidence",
    title: "How solid the evidence is",
    sources: [],
    mix,
    grounded: groundedShare(mix),
    sourceKinds: sourceMix(report).map((s) => ({ label: s.label, value: s.value })),
    counts: {
      counted: claims.filter((c) => c.status !== "rejected").length,
      downgraded: claims.filter((c) => c.status === "downgraded").length,
      rejected: claims.filter((c) => c.status === "rejected").length,
      sources: Object.keys(report.sources).length,
      evidence: Object.keys(report.evidence).length,
    },
  });

  slides.push({
    kind: "risks",
    id: "risks",
    title: "Key risks and what we do not know",
    sources: [],
    risks: [...report.key_risks]
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
      .slice(0, 6)
      .map((r) => ({ category: humanize(r.category), severity: r.severity, text: r.text })),
    unknowns: report.critical_unknowns.slice(0, 6),
  });

  slides.push({
    kind: "recommendation",
    id: "recommendation",
    title: "Our recommendation",
    sources: [],
    decision: verdict.decision,
    decisionLabel: DECISION_LABEL[verdict.decision],
    confidence: verdict.confidence,
    pos: report.pos,
    rationale: verdict.rationale,
    conditions: verdict.conditions,
    questions: [...report.diligence_questions]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 4)
      .map((d) => ({ question: d.question, why: d.why_it_matters })),
    footnote: `Run ${report.run_id}, ${dateOf(report.meta.created_at)}.`,
  });

  return { slides, synthetic };
}
