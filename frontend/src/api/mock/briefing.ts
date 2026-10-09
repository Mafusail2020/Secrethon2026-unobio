import { DECISION_LABEL } from "../../lib/format";
import type { UnderwritingReport } from "../types";

const SECTIONS = ["disease_need", "scientific_thesis", "translation", "clinical_plan", "competition", "commercial_adoption", "capital"] as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => {
  const sign = x < 0 ? "-" : "";
  const n = Math.abs(x);
  return n >= 1e6 ? `${sign}$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${sign}$${(n / 1e3).toFixed(1)}K` : `${sign}$${n.toFixed(0)}`;
};

/** Mirrors the backend's template briefing, so the mock UI shows the same shape with no server. */
export function briefing(report: UnderwritingReport): { text: string; cited: string[]; passages: string[] } {
  const { verdict, pos } = report;
  const cite = (ids: string[]) => ids.filter((id) => id in report.claims).map((id) => ` [[${id}]]`).join("");
  const parts = [
    "## Verdict",
    `**${DECISION_LABEL[verdict.decision]}** at ${verdict.confidence} confidence. Probability of success about **${pct(pos.base)}** (range ${pct(pos.low)} to ${pct(pos.high)}).\n\n${verdict.rationale}`,
  ];
  if (verdict.reason_codes.length) {
    parts.push(
      "## Why this call",
      verdict.reason_codes.map((r) => `- **${r.direction === "positive" ? "For" : "Against"}:** ${r.text}${cite(r.claim_ids)}`).join("\n"),
    );
  }
  const sections = SECTIONS.flatMap((id) => (report.sections[id] ? [report.sections[id]] : []));
  if (sections.length) {
    parts.push("## What the report found");
    for (const s of sections) {
      const points = s.key_points.slice(0, 3).map((p) => `- ${p.text}${cite(p.claim_ids)}`).join("\n");
      parts.push([`### ${s.title}`, s.summary, points].filter(Boolean).join("\n\n"));
    }
  }
  const filePassages = Object.values(report.evidence)
    .filter((e) => report.sources[e.source_id]?.identifiers.document)
    .slice(0, 3);
  if (filePassages.length) {
    const quote = (text: string) => text.replace(/([*_`[\]\\])/g, "\\$1");
    parts.push(
      "## Your documents",
      filePassages
        .map((e) => `- **${report.sources[e.source_id]!.title.replace("User document: ", "")}${e.locator ? `, ${e.locator}` : ""}:** "${quote(e.excerpt)}" [[${e.id}]]`)
        .join("\n"),
    );
  }
  if (report.valuation) {
    const v = report.valuation;
    parts.push(
      "## Funding to the next milestone",
      [
        `- **Milestone:** ${v.next_milestone}`,
        `- **Capital needed:** ${usd(v.capital_to_milestone.base)} (${usd(v.capital_to_milestone.low)} to ${usd(v.capital_to_milestone.high)})`,
        `- **Time:** ${v.time_to_milestone_months.base.toFixed(0)} months (${v.time_to_milestone_months.low.toFixed(0)} to ${v.time_to_milestone_months.high.toFixed(0)})`,
        `- **Risk-adjusted value (rNPV):** ${usd(v.rnpv.base)} (${usd(v.rnpv.low)} to ${usd(v.rnpv.high)})`,
      ].join("\n"),
    );
  }
  const risks = report.key_risks.map((r) => `- **${r.severity}** (${r.category}): ${r.text}${cite(r.claim_ids)}`);
  const unknowns = Object.values(report.sections).flatMap((s) => s.unknowns.slice(0, 2).map((u) => `- *Unknown:* ${u}`)).slice(0, 4);
  if (risks.length || unknowns.length) parts.push("## Risks and unknowns", [...risks, ...unknowns].join("\n"));
  const next = [...verdict.conditions.map((c) => `- ${c}`), ...report.diligence_questions.slice(0, 3).map((q) => `- *Ask:* ${q.question}`)];
  if (next.length) parts.push("## What to do next", next.join("\n"));
  const text = parts.join("\n\n");
  const marks = [...new Set([...text.matchAll(/\[\[([^[\]\s]+)\]\]/g)].map((m) => m[1]!))];
  return { text, cited: marks.filter((id) => id in report.claims), passages: marks.filter((id) => id in report.evidence) };
}
