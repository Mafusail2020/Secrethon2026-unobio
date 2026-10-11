import { DECISION_LABEL, humanize, usd } from "../../../../lib/format";
import { splitMore } from "./outputSummary";
import { baseId } from "./panel";

/** What a step did, in a few plain sentences, worked out from the compact output the server keeps of it. */
export interface PlainOutput {
  headline: string;
  points: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const range = (v: unknown) => {
  const r = obj(v);
  return r && num(r.low) !== undefined && num(r.base) !== undefined && num(r.high) !== undefined ? { low: r.low as number, base: r.base as number, high: r.high as number } : undefined;
};

/** The server cuts long lists after five and long dicts after twenty entries and says how many it left out. */
function countOf(v: unknown): number | undefined {
  if (Array.isArray(v)) {
    const { items, more } = splitMore(v);
    return items.length + more;
  }
  const o = obj(v);
  if (!o) return undefined;
  const more = Number(/^(\d+) more$/.exec(String(o["…"] ?? ""))?.[1] ?? 0);
  return Object.keys(o).filter((k) => k !== "…").length + more;
}
const itemsOf = (v: unknown): unknown[] => (Array.isArray(v) ? splitMore(v).items : []);
const entriesOf = (v: unknown): [string, unknown][] => Object.entries(obj(v) ?? {}).filter(([k]) => k !== "…");
// one decimal, as the model's own sentences give them: 10.6% beside an 11% would read as two different numbers
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pctRange = (r: { low: number; base: number; high: number }) => `${pct(r.base)} (from ${pct(r.low)} to ${pct(r.high)})`;
const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (text: string, n = 160) => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);
const names = (v: unknown, limit = 4) => {
  const all = itemsOf(v).filter((x): x is string => typeof x === "string");
  const total = countOf(v) ?? all.length;
  return all.slice(0, limit).join(", ") + (total > limit ? `, and ${total - limit} more` : "");
};
const lower = (text: string) => humanize(text).toLowerCase();
const sentence = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const ranked = (v: unknown, limit = 3) =>
  entriesOf(v)
    .flatMap(([k, n]) => (typeof n === "number" ? [[k, n] as const] : []))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, n]) => `${lower(k)} (${n})`)
    .join(", ");
/** The step's own working notes, which the server keeps under `scratch` and the step's id. */
const scratchOf = (out: Obj, id: string) => obj(obj(out.scratch)?.[id]);

function fetched(out: Obj, what: string): string {
  const sources = countOf(out.source_ids) ?? 0;
  const evidence = countOf(out.evidence_ids) ?? 0;
  return sources + evidence === 0 ? `Found nothing new in ${what}` : `Found ${noun(sources, "source")} and ${noun(evidence, "evidence item")} in ${what}`;
}

function describeFetch(id: string, out: Obj): PlainOutput | undefined {
  const own = scratchOf(out, id);
  const points: string[] = [];
  if (id === "fetch_literature") {
    const queries = countOf(own?.queries);
    if (queries) points.push(`Searched the literature with ${noun(queries, "query", "queries")}: ${entriesOf(own?.queries).map(([k]) => k).join(", ")}`);
    return { headline: fetched(out, "the literature"), points };
  }
  if (id === "fetch_opentargets") {
    const score = num(own?.association_score);
    if (score !== undefined) points.push(`Target–disease association score ${score.toFixed(2)} out of 1`);
    if (own && own.genetic_association == null) points.push("No human genetic association found");
    const drugs = num(own?.target_drugs);
    if (drugs !== undefined) points.push(`${noun(drugs, "drug")} act${drugs === 1 ? "s" : ""} on this target`);
    return { headline: fetched(out, "Open Targets"), points };
  }
  if (id === "fetch_regulatory") {
    const apps = entriesOf(own?.fda_applications).filter(([, v]) => countOf(v));
    if (apps.length) points.push(`FDA applications found for ${noun(apps.length, "drug")}: ${apps.map(([k]) => k).join(", ")}`);
    if (countOf(own?.standard_of_care)) points.push(`Current standard of care: ${names(own?.standard_of_care)}`);
    if (countOf(own?.same_target_approved)) points.push(`Approved drugs on the same target: ${names(own?.same_target_approved)}`);
    return { headline: fetched(out, "regulatory records"), points };
  }
  if (id === "fetch_safety") {
    if (countOf(own?.liabilities)) points.push(`Known safety liabilities of the target: ${names(own?.liabilities)}`);
    if (countOf(own?.same_target_approved)) points.push(`Approved drugs on the same target: ${names(own?.same_target_approved)}`);
    return { headline: fetched(out, "safety data"), points };
  }
  if (id === "fetch_trials") {
    const statuses = entriesOf(own?.statuses).map(([k, n]) => `${n} ${lower(k)}`);
    if (statuses.length) points.push(`Trials found: ${statuses.join(", ")}`);
    const stopped = countOf(own?.stopped);
    if (stopped) points.push(`${noun(stopped, "trial")} stopped early`);
    return { headline: fetched(out, "ClinicalTrials.gov"), points };
  }
  return undefined;
}

function describeDraft(id: string, out: Obj): PlainOutput | undefined {
  const own = scratchOf(out, id);
  if (!own) return undefined;
  const claims = countOf(own.claims) ?? 0;
  const evidence = countOf(own.evidence_ids) ?? 0;
  const points = [`Read ${noun(evidence, "evidence item")}`];
  const quotes = countOf(own.quotes);
  if (claims > 0 && quotes) points.push(`${noun(quotes, "quote")} copied from the evidence, to be checked word for word`);
  const chain = countOf(own.chain);
  if (chain) points.push(`${noun(chain, "translation step")} looked at`);
  if (claims === 0) points.push("No claim came out of this evidence, so nothing from it reaches the report.");
  return { headline: claims === 0 ? "Drafted no claims" : `Drafted ${noun(claims, "claim")}`, points };
}

function describeGate(out: Obj): PlainOutput | undefined {
  const claims = obj(out.claims);
  if (!claims) return undefined;
  const total = countOf(claims) ?? 0;
  const shown = entriesOf(claims).map(([, c]) => obj(c)).filter((c): c is Obj => !!c);
  const by = (status: string) => shown.filter((c) => c.status === status).length;
  const parts = [`${by("accepted")} kept`, ...(by("downgraded") ? [`${by("downgraded")} downgraded`] : []), ...(by("rejected") ? [`${by("rejected")} rejected`] : [])];
  const points = [...new Set(shown.flatMap((c) => str(c.rejection_reason) ?? []))].slice(0, 3).map((reason) => `Why a claim was not kept as it was: ${reason}`);
  if (total > shown.length) points.push(`The first ${shown.length} of ${total} claims are counted here`);
  const chain = countOf(out.translation_chain);
  if (chain) points.push(`${noun(chain, "translation step")} rated`);
  return { headline: `Checked ${noun(total, "claim")} against their evidence: ${parts.join(", ")}`, points };
}

function describeScore(out: Obj): PlainOutput | undefined {
  const [cause, assessment] = entriesOf(out.assessments)[0] ?? [];
  const a = obj(assessment);
  if (!cause || !a) return undefined;
  const points = [str(a.headline) ?? ""].filter(Boolean);
  for (const [, adj] of entriesOf(out.risk_adjustments)) {
    const x = obj(adj);
    const ratio = range(x?.risk_ratio);
    if (x && ratio && str(x.factor)) points.push(`Risk factor: ${x.factor} (${ratio.base >= 1 ? "raises" : "lowers"} the risk ×${ratio.base.toFixed(2)})`);
  }
  return { headline: `Rated ${cause}: ${a.rating}`, points };
}

function describeLedger(out: Obj): PlainOutput | undefined {
  const ledger = obj(out.ledger);
  const prior = range(ledger?.prior);
  const posterior = range(ledger?.posterior);
  if (!prior || !posterior) return undefined;
  let before = prior.base;
  const points: string[] = [];
  for (const step of itemsOf(ledger?.steps)) {
    const s = obj(step);
    const after = range(s?.pos_after);
    if (!s || !after || !str(s.factor)) continue;
    const delta = (after.base - before) * 100;
    before = after.base;
    points.push(`${s.factor}: ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} points`);
  }
  const total = countOf(ledger?.steps) ?? 0;
  if (total > points.length) points.push(`… and ${total - points.length} more steps`);
  return { headline: `The chance of success went from ${pctRange(prior)} to ${pctRange(posterior)}`, points };
}

function describeValuation(out: Obj): PlainOutput | undefined {
  const v = obj(out.valuation);
  const capital = range(v?.capital_to_milestone);
  const value = range(v?.rnpv);
  if (!v || !capital || !value) return undefined;
  const months = range(v.time_to_milestone_months);
  return {
    headline: `Getting to ${str(v.next_milestone) ?? "the next milestone"} needs about ${usd(capital.base)}`,
    points: [
      `Capital needed: ${usd(capital.base)} (from ${usd(capital.low)} to ${usd(capital.high)})`,
      ...(months ? [`Time: ${months.base.toFixed(0)} months (from ${months.low.toFixed(0)} to ${months.high.toFixed(0)})`] : []),
      `Risk-adjusted value: ${usd(value.base)} (from ${usd(value.low)} to ${usd(value.high)})`,
    ],
  };
}

function describeVerdict(out: Obj): PlainOutput | undefined {
  const v = obj(out.verdict);
  const decision = str(v?.decision) as keyof typeof DECISION_LABEL | undefined;
  if (!v || !decision || !(decision in DECISION_LABEL)) return undefined;
  const reasons = itemsOf(v.reason_codes).flatMap((r) => str(obj(r)?.text) ?? []);
  const conditions = countOf(v.conditions);
  return {
    headline: `${DECISION_LABEL[decision]}, with ${str(v.confidence) ?? "unknown"} confidence`,
    points: [...(str(v.rationale) ? [str(v.rationale)!] : []), ...reasons.map((t) => `Reason: ${clip(t)}`), ...(conditions ? [`${noun(conditions, "condition")} to clear before funding`] : [])],
  };
}

/** The step's output told as a person would tell it, or nothing when its shape is not one this knows. */
export function plainOutput(nodeId: string, output: Obj): PlainOutput | undefined {
  const id = baseId(nodeId);
  try {
    if (id.startsWith("fetch_")) return describeFetch(id, output);
    if (id === "input_resolver") {
      const e = obj(output.entities);
      const disease = obj(e?.disease);
      const target = obj(e?.target);
      const drug = obj(e?.drug);
      if (!disease) return undefined;
      return {
        headline: target ? `Matched your input to ${disease.label} and ${target.label}` : `Matched your input to ${disease.label}, but found no target`,
        points: [
          `Disease: ${disease.label} (${disease.id})`,
          ...(target ? [`Target: ${target.label} (${target.id})`] : []),
          `Drug: ${str(drug?.label) ?? "none given"}`,
          ...(str(e?.mechanism_class) ? [`Kind of mechanism: ${e!.mechanism_class}`] : []),
          ...(str(e?.confidence) ? [`Confidence in the match: ${e!.confidence}`] : []),
        ],
      };
    }
    if (id === "question_planner") {
      const total = countOf(output.questions);
      if (total === undefined) return undefined;
      const shown = itemsOf(output.questions).flatMap((q) => (obj(q) && str(obj(q)!.question) ? [`${sentence(humanize(str(obj(q)!.section) ?? ""))}: ${clip(str(obj(q)!.question)!)}`] : []));
      return { headline: `Planned ${noun(total, "question")} to answer`, points: [...shown, ...(total > shown.length ? [`… and ${total - shown.length} more`] : [])] };
    }
    if (id === "twin_stats") {
      const t = obj(output.twin_stats);
      const prior = range(t?.prior_pos);
      const n = num(t?.n_programs);
      if (!t || n === undefined) return undefined;
      return {
        headline: `Matched ${noun(n, "similar program")} (${lower(str(t.match_level) ?? "unknown")} match)`,
        points: [
          ...(prior ? [`Starting chance of success from their record: ${pctRange(prior)}`] : []),
          ...(ranked(t.stage_distribution) ? [`Furthest stage they reached, most common first: ${ranked(t.stage_distribution)}`] : []),
          ...(ranked(t.stop_reasons) ? [`Why the stopped ones stopped: ${ranked(t.stop_reasons)}`] : []),
        ],
      };
    }
    if (id === "knowledge_indexer") {
      const own = scratchOf(output, id);
      const indexed = num(own?.indexed);
      if (indexed === undefined) return undefined;
      return { headline: `Indexed ${noun(indexed, "evidence item")} for search`, points: num(own?.kg_edges) !== undefined ? [`${noun(own!.kg_edges as number, "link")} between drugs, targets and diseases`] : [] };
    }
    if (id.endsWith("_query_planner")) {
      const queries = scratchOf(output, id)?.queries;
      const total = countOf(queries);
      if (total === undefined) return undefined;
      const shown = itemsOf(queries).filter((q): q is string => typeof q === "string");
      return { headline: `Wrote ${noun(total, "search query", "search queries")}`, points: [...shown, ...(total > shown.length ? [`… and ${total - shown.length} more`] : [])] };
    }
    if (id.endsWith("_gather") || id.endsWith("_retriever")) {
      const found = countOf(scratchOf(output, id)?.evidence_ids) ?? countOf(output.evidence_ids);
      if (found === undefined) return undefined;
      return { headline: `${id.endsWith("_gather") ? "Selected" : "Retrieved"} ${noun(found, "evidence item")} to read`, points: [] };
    }
    if (id.endsWith("_extract") || id.endsWith("_claim_writer")) return describeDraft(id, output);
    if (id.endsWith("_gate")) return describeGate(output);
    if (id.endsWith("_score")) return describeScore(output);
    if (id === "section_analysts") {
      const sections = countOf(output.sections);
      if (sections === undefined) return undefined;
      const part = (key: string, one: string, many?: string) => (countOf(output[key]) !== undefined ? [noun(countOf(output[key])!, one, many)] : []);
      return { headline: `Wrote ${noun(sections, "report section")}`, points: [`With ${[...part("claims", "claim"), ...part("key_risks", "key risk"), ...part("critical_unknowns", "open unknown"), ...part("diligence_questions", "diligence question")].join(", ")}`] };
    }
    if (id === "evidence_ledger") return describeLedger(output);
    if (id === "valuation") return describeValuation(output);
    if (id === "verdict") return describeVerdict(output);
    if (id === "report_assembler") {
      const r = obj(output.report);
      const claims = countOf(r?.claims);
      if (!r || claims === undefined) return undefined;
      return { headline: "Assembled the report", points: [`${noun(claims, "claim")} from ${noun(countOf(r.sources) ?? 0, "source")}, in ${noun(countOf(r.sections) ?? 0, "section")}`] };
    }
  } catch {
    // an output of an unexpected shape is shown as raw data instead
  }
  return undefined;
}
