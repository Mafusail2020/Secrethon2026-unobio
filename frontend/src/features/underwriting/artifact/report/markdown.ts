import type { Claim, UnderwritingReport } from "../../../../api/types";
import { DECISION_LABEL, humanize, pctRange } from "../../../../lib/format";
import { isSyntheticReport } from "./synthetic";

const SECTION_ORDER = [
  "disease_need",
  "scientific_thesis",
  "translation",
  "safety",
  "clinical_plan",
  "competition",
  "commercial_adoption",
  "capital",
  "risks",
] as const;

function claimLine(claim: Claim, report: UnderwritingReport): string {
  const flags = [claim.stance, claim.label, `${claim.confidence} confidence`];
  if (claim.status !== "accepted") flags.push(claim.status);
  const sources = claim.evidence_ids.flatMap((id) => {
    const evidence = report.evidence[id];
    const source = evidence && report.sources[evidence.source_id];
    if (!source) return [];
    const name = source.title.replace(/[[\]]/g, "");
    return [source.url ? `[${name}](${source.url})` : name];
  });
  const reason = claim.rejection_reason ? ` (${claim.rejection_reason})` : "";
  return `- ${claim.text} _[${flags.join(", ")}]_${reason}${sources.length ? ` — ${[...new Set(sources)].join("; ")}` : ""}`;
}

/** The report as Markdown: verdict, sections with their claims and source links, questions and run details. */
export function toMarkdown(report: UnderwritingReport): string {
  const { verdict, meta } = report;
  const lines: string[] = [`# ${report.program.mechanism} in ${report.program.indication}`, ""];
  if (isSyntheticReport(report)) lines.push("> Synthetic data: this report contains placeholder content.", "");
  lines.push(
    `**Verdict: ${DECISION_LABEL[verdict.decision]}** (${verdict.confidence} confidence) · probability of success ${pctRange(report.pos)}`,
    "",
    verdict.rationale,
    "",
  );
  if (verdict.reason_codes.length) {
    lines.push("## Reasons", "");
    for (const r of verdict.reason_codes) lines.push(`- ${r.direction === "positive" ? "▲" : "▼"} ${r.text}`);
    lines.push("");
  }
  if (verdict.conditions.length) {
    lines.push("## Conditions", "", ...verdict.conditions.map((c) => `- ${c}`), "");
  }
  const shown = new Set<string>();
  for (const id of SECTION_ORDER) {
    const section = report.sections[id];
    if (!section) continue;
    lines.push(`## ${section.title}`, "", `_${humanize(section.status)}_`, "", section.summary, "");
    for (const kp of section.key_points) {
      lines.push(`**${kp.text}**`, "");
      for (const claimId of kp.claim_ids) {
        const claim = report.claims[claimId];
        if (claim) {
          shown.add(claimId);
          lines.push(claimLine(claim, report));
        }
      }
      lines.push("");
    }
    if (section.unknowns.length) lines.push(`Unknown: ${section.unknowns.join("; ")}`, "");
  }
  const others = Object.values(report.claims).filter((c) => !shown.has(c.id));
  if (others.length) {
    lines.push("## Other claims", "", "Claims not attached to a key point above, including rejected and downgraded ones.", "");
    for (const claim of others) lines.push(claimLine(claim, report));
    lines.push("");
  }
  if (report.key_risks.length) {
    lines.push("## Key risks", "");
    for (const r of report.key_risks) lines.push(`- **${humanize(r.category)} (${r.severity}):** ${r.text}`);
    lines.push("");
  }
  if (report.critical_unknowns.length) {
    lines.push("## Critical unknowns", "", ...report.critical_unknowns.map((u) => `- ${u}`), "");
  }
  if (report.diligence_questions.length) {
    lines.push("## Diligence questions", "");
    for (const q of [...report.diligence_questions].sort((a, b) => a.priority - b.priority)) {
      lines.push(`${q.priority}. ${q.question} — ${q.why_it_matters} (needs: ${q.requires.map(humanize).join(", ") || "n/a"})`);
    }
    lines.push("");
  }
  const cost = meta.cost_usd === null ? "price unknown" : `$${meta.cost_usd.toFixed(4)}`;
  lines.push(
    "## Run details",
    "",
    `Run ${report.run_id} · ${meta.models_used.join(", ") || "no model calls"} · effort ${meta.effort} · ${meta.tokens_in + meta.tokens_out} tokens · ${cost} · ${meta.duration_s}s`,
  );
  if (meta.failed_nodes.length) lines.push("", `Degraded: ${meta.failed_nodes.join(", ")} did not complete.`);
  return lines.join("\n") + "\n";
}
