import type { Claim, Range, UnderwritingReport } from "../../../../../api/types";
import { DECISION_LABEL, humanize, months, usd, usdRange } from "../../../../../lib/format";
import { buildReportTree, STANDING_LABEL, type QuestionNode } from "../reportTree";
import { isSyntheticReport } from "../synthetic";
import { buildWaterfall } from "../waterfall";

export interface NoteSource {
  n: number;
  title: string;
  url: string | null;
  detail: string;
}

export interface NoteDoc {
  /** the body as Markdown, starting with the title */
  markdown: string;
  /** the front matter an Obsidian note keeps in its Properties panel */
  properties: { key: string; value: string }[];
  tags: string[];
  /** the second-level headings, for the outline beside the note */
  outline: { id: string; text: string }[];
  /** numbered the way the text cites them: by first use */
  sources: NoteSource[];
  synthetic: boolean;
}

// one decimal everywhere: the model's own sentences say 10.6%, and 11% beside them would read as a different number
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pctRange = (r: Range) => `${pct1(r.base)} (${pct1(r.low)} to ${pct1(r.high)})`;

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// a claim or a source title is prose, but it may hold characters Markdown reads as marks
const esc = (text: string) => text.replace(/([\\`*_[\]<>#|~])/g, "\\$1");
const clip = (text: string, n: number) => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);

class Cites {
  order: string[] = [];
  constructor(private report: UnderwritingReport) {}

  of(evidenceIds: readonly string[]): number[] {
    const numbers = new Set<number>();
    for (const id of evidenceIds) {
      const evidence = this.report.evidence[id];
      if (!evidence || !this.report.sources[evidence.source_id]) continue;
      if (!this.order.includes(evidence.source_id)) this.order.push(evidence.source_id);
      numbers.add(this.order.indexOf(evidence.source_id) + 1);
    }
    return [...numbers].sort((a, b) => a - b);
  }
}

const refs = (numbers: number[]) => (numbers.length ? ` ${numbers.map((n) => `[${n}](#src-${n})`).join("")}` : "");

function claimLines(claim: Claim, report: UnderwritingReport, cites: Cites): string[] {
  const meta = [claim.label, `${claim.confidence} confidence`, ...(claim.status === "accepted" ? [] : [claim.status])].join(" · ");
  const lines = [`- ${esc(claim.text)}${refs(cites.of(claim.evidence_ids))} — *${meta}*`];
  const quotes: string[] = [];
  if (claim.rejection_reason) quotes.push(`Rejected by the evidence gate: ${esc(claim.rejection_reason)}`);
  for (const id of claim.evidence_ids.slice(0, 2)) {
    const evidence = report.evidence[id];
    const source = evidence && report.sources[evidence.source_id];
    if (evidence && source) quotes.push(`“${esc(clip(evidence.excerpt, 220))}” — ${esc(clip(source.title, 80))}${evidence.locator ? `, ${esc(evidence.locator)}` : ""}`);
  }
  quotes.forEach((q, i) => lines.push(`${i === 0 ? "" : "  >\n"}  > ${q}`));
  return lines;
}

const heaviest = (claims: Claim[]) => [...claims].sort((a, b) => Number(b.confidence === "high") - Number(a.confidence === "high"));

function questionLines(q: QuestionNode, report: UnderwritingReport, cites: Cites): string[] {
  const out = [`## ${q.title}`, "", `*${STANDING_LABEL[q.standing]} · ${q.basis}*`, "", esc(q.headline), ""];
  const group = (title: string, claims: Claim[]) => {
    if (claims.length === 0) return;
    out.push(`### ${title}`, "");
    for (const claim of heaviest(claims)) out.push(...claimLines(claim, report, cites));
    out.push("");
  };
  if (q.pros.length === 0 && q.cons.length === 0) out.push("*No claim either way.*", "");
  group("For", q.pros);
  group("Against", q.cons);
  group("Context", q.neutral);
  group("Rejected by the evidence gate", q.rejected);
  if (q.sections.length > 0) {
    out.push("### What the sections say", "");
    for (const section of q.sections) {
      out.push(`#### ${esc(section.title)} (${humanize(section.status)})`, "", esc(section.summary), "");
      if (section.unknowns.length > 0) out.push(`> What we could not establish: ${esc(section.unknowns.join("; "))}`, "");
    }
  }
  if (q.unknowns.length > 0 && q.sections.length === 0) out.push(`> What we could not establish: ${esc(q.unknowns.join("; "))}`, "");
  return out;
}

function numbersLines(report: UnderwritingReport): string[] {
  const out = ["## The numbers behind it", ""];
  if (report.ledger) {
    const wf = buildWaterfall(report.ledger);
    out.push(`### How the chance of success was built`, "", `From a prior of ${pctRange(report.ledger.prior)} to ${pctRange(report.pos)}. Each row is the points one piece of evidence added or took away.`, "");
    if (wf.steps.length > 0) {
      out.push("| Evidence | Cause | Effect |", "| --- | --- | ---: |");
      for (const { step, start, end } of wf.steps) out.push(`| ${esc(step.factor)} | ${humanize(step.cause)} | ${((end - start) * 100).toFixed(1)} pts |`);
      out.push("");
    }
  }
  if (report.twin_stats) {
    const t = report.twin_stats;
    out.push("### Similar programs", "", `${t.n_programs} programs matched on ${humanize(t.match_level)}; starting chance ${pctRange(t.prior_pos)}.`, "");
    if (t.twins.length > 0) {
      out.push("| Drug | Disease | Stage | Status |", "| --- | --- | --- | --- |");
      for (const w of t.twins.slice(0, 10)) out.push(`| ${esc(w.drug)} | ${esc(w.disease)} | ${humanize(w.max_stage)} | ${humanize(w.status)} |`);
      out.push("");
    }
  }
  if (report.valuation) {
    const v = report.valuation;
    out.push("### Funding to the next milestone", "", `- Next milestone: ${esc(v.next_milestone)}`, `- Capital needed: ${usdRange(v.capital_to_milestone)}`, `- Time: ${months(v.time_to_milestone_months)}`, `- Risk-adjusted value: ${usdRange(v.rnpv)}`, "");
  }
  for (const a of report.assessments) {
    out.push(`### ${humanize(a.cause)} check: ${a.rating}`, "", esc(a.headline), "");
    if (a.gaps.length > 0) out.push(`> Could not check: ${esc(a.gaps.join("; "))}`, "");
  }
  return out;
}

/** The report as a note: what a reader of an Obsidian vault would expect, with every claim traced to numbered sources. */
export function buildNote(report: UnderwritingReport): NoteDoc {
  const { verdict, meta } = report;
  const tree = buildReportTree(report);
  const cites = new Cites(report);
  const program = `${report.program.mechanism} in ${report.program.indication}`;

  const reason = (r: (typeof verdict.reason_codes)[number]) => {
    const claim = report.claims[r.claim_ids[0] ?? ""];
    return `- ${esc(r.text)}${refs(claim ? cites.of(claim.evidence_ids) : [])}`;
  };
  const body = [
    `# ${esc(program)}`,
    "",
    "## Verdict",
    "",
    `**${DECISION_LABEL[verdict.decision]}** · ${verdict.confidence} confidence · probability of success **${pctRange(report.pos)}**`,
    "",
    esc(verdict.rationale),
    "",
  ];
  if (tree.reasons.positive.length > 0) body.push("### What carries it", "", ...tree.reasons.positive.map(reason), "");
  if (tree.reasons.negative.length > 0) body.push("### What holds it back", "", ...tree.reasons.negative.map(reason), "");
  if (verdict.conditions.length > 0) body.push("### To proceed", "", ...verdict.conditions.map((c) => `- ${esc(c)}`), "");
  for (const q of tree.questions) body.push(...questionLines(q, report, cites));
  if (tree.unplaced.length > 0) {
    body.push("## Other claims", "");
    for (const claim of tree.unplaced) body.push(...claimLines(claim, report, cites));
    body.push("");
  }
  body.push(...numbersLines(report));
  body.push("## Risks and what we do not know", "");
  for (const r of [...report.key_risks].sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity))) {
    body.push(`- **${r.severity}** (${humanize(r.category)}): ${esc(r.text)}`);
  }
  for (const u of report.critical_unknowns) body.push(`- *Unknown:* ${esc(u)}`);
  body.push("");
  if (report.diligence_questions.length > 0) {
    body.push("### Questions to ask before committing", "");
    for (const q of [...report.diligence_questions].sort((a, b) => a.priority - b.priority)) body.push(`${q.priority}. **${esc(q.question)}** ${esc(q.why_it_matters)}`);
    body.push("");
  }

  const sources: NoteSource[] = cites.order.map((id, i) => {
    const s = report.sources[id]!;
    const ids = Object.entries(s.identifiers).filter(([k]) => k !== "chunks").map(([k, v]) => `${k} ${v}`).join(", ");
    return { n: i + 1, title: s.title, url: s.url ?? null, detail: [s.publisher, humanize(s.type), ids].filter(Boolean).join(" · ") };
  });

  const properties = [
    { key: "decision", value: `${DECISION_LABEL[verdict.decision]} (${verdict.confidence} confidence)` },
    { key: "probability of success", value: pctRange(report.pos) },
    ...(report.valuation
      ? [
          { key: "risk-adjusted value", value: usdRange(report.valuation.rnpv) },
          { key: "capital to milestone", value: `${usd(report.valuation.capital_to_milestone.base)} for ${report.valuation.next_milestone}` },
        ]
      : []),
    { key: "claims", value: `${Object.keys(report.claims).length}, from ${Object.keys(report.sources).length} sources` },
    { key: "run", value: report.run_id },
    { key: "created", value: meta.created_at.slice(0, 16).replace("T", " ") },
    { key: "model", value: meta.models_used.join(", ") || "none" },
  ];
  const outline = [...body.join("\n").matchAll(/^## (.+)$/gm)].map((m) => ({ id: slug(m[1]!), text: m[1]!.replace(/\\(.)/g, "$1") }));
  if (sources.length > 0) outline.push({ id: "sources", text: "Sources" });

  return {
    markdown: body.join("\n"),
    properties,
    tags: [`#${verdict.decision.replace(/_/g, "-")}`, `#${slug(report.program.indication)}`, `#${slug(report.program.mechanism)}`],
    outline,
    sources,
    synthetic: isSyntheticReport(report),
  };
}
