import type { GraphSpec, NodeSpec, NodeStatus } from "../../api/types";
import { runnableNodes } from "./graphUtils";
import type { NodeLive } from "./reduceEvents";

export type PhaseId =
  | "resolve"
  | "plan"
  | "fetch"
  | "index"
  | "cases"
  | "analyse"
  | "quant"
  | "report"
  | "other";

export type PhaseStatus = "pending" | "running" | "done" | "failed" | "degraded" | "reused";

export const PHASE_DEFS: { id: PhaseId; label: string; description: string }[] = [
  { id: "resolve", label: "Understand the program", description: "Resolve the indication, target and drug" },
  { id: "plan", label: "Plan the questions", description: "Decide which questions matter for this program" },
  { id: "fetch", label: "Gather public evidence", description: "Trials, literature, regulators, Open Targets and your notes" },
  { id: "index", label: "Freeze and index the evidence", description: "Deduplicate and index the evidence set" },
  { id: "cases", label: "Argue both sides", description: "Strongest reasons to invest and not to, built in parallel" },
  { id: "analyse", label: "Write the analysis", description: "Sections, risks, unknowns and diligence questions" },
  { id: "quant", label: "Quantify and decide", description: "Evidence ledger, valuation and verdict" },
  { id: "report", label: "Assemble the report", description: "Claims, evidence and sources in one document" },
  { id: "other", label: "Other steps", description: "Steps outside the standard pipeline" },
];

// fallback for specs that do not declare a phase; unknown ids land in "other"
const NODE_PHASE: Record<string, PhaseId> = {
  input_resolver: "resolve",
  question_planner: "plan",
  fetch_opentargets: "fetch",
  fetch_trials: "fetch",
  fetch_literature: "fetch",
  fetch_regulatory: "fetch",
  ingest_user_input: "fetch",
  twin_stats: "fetch",
  evidence_normalizer: "index",
  knowledge_indexer: "index",
  section_analysts: "analyse",
  evidence_ledger: "quant",
  valuation: "quant",
  verdict: "quant",
  report_assembler: "report",
};

export function phaseOf(node: NodeSpec): PhaseId {
  return node.phase ?? NODE_PHASE[node.id] ?? (node.parent ? "cases" : "other");
}

export interface PhaseProblem {
  nodeId: string;
  label: string;
  status: NodeStatus;
  reason: string;
}

export interface PhaseView {
  id: PhaseId;
  label: string;
  description: string;
  nodes: NodeSpec[];
  /** parallel groups inside one phase, e.g. the bull and bear case */
  lanes: { id: string; label: string; nodes: NodeSpec[] }[];
  status: PhaseStatus;
  startedAt?: string;
  durationMs?: number;
  llmCalls: number;
  lastLog?: string;
  problems: PhaseProblem[];
  finished: number;
}

function aggregate(statuses: NodeStatus[]): PhaseStatus {
  if (statuses.every((s) => s === "pending")) return "pending";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("pending")) return "running"; // between two nodes of the same phase
  if (statuses.includes("skipped")) return "degraded";
  if (statuses.every((s) => s === "reused")) return "reused";
  return "done";
}

export function groupPhases(spec: GraphSpec, live: Record<string, NodeLive>): PhaseView[] {
  const byPhase = new Map<PhaseId, NodeSpec[]>();
  for (const node of runnableNodes(spec)) {
    const id = phaseOf(node);
    byPhase.set(id, [...(byPhase.get(id) ?? []), node]);
  }
  const labels = new Map(spec.nodes.map((n) => [n.id, n.label]));

  return PHASE_DEFS.flatMap((def) => {
    const nodes = byPhase.get(def.id);
    if (!nodes?.length) return [];
    const states = nodes.map((n) => live[n.id]);
    const statuses = states.map((s) => s?.status ?? "pending");

    const lanes: PhaseView["lanes"] = [];
    if (nodes.some((n) => n.parent)) {
      for (const node of nodes) {
        const laneId = node.parent ?? node.id;
        const lane = lanes.find((l) => l.id === laneId);
        if (lane) lane.nodes.push(node);
        else lanes.push({ id: laneId, label: labels.get(laneId) ?? laneId, nodes: [node] });
      }
    }

    const starts = states.flatMap((s) => (s?.startedAt ? [new Date(s.startedAt).getTime()] : []));
    const ends = states.flatMap((s) =>
      s?.startedAt && s.durationMs !== undefined ? [new Date(s.startedAt).getTime() + s.durationMs] : [],
    );
    const finished = statuses.filter((s) => s !== "pending" && s !== "running").length;
    const start = starts.length ? Math.min(...starts) : undefined;
    const allEnded = ends.length > 0 && finished === nodes.length && statuses.every((s) => s !== "reused");

    const withLogs = states.flatMap((s) => (s?.logs.length ? [s.logs[s.logs.length - 1]!] : []));
    const lastLog = withLogs.sort((a, b) => b.seq - a.seq)[0]?.message;

    return [
      {
        id: def.id,
        label: def.label,
        description: def.description,
        nodes,
        lanes,
        status: aggregate(statuses),
        startedAt: start === undefined ? undefined : new Date(start).toISOString(),
        durationMs: start !== undefined && allEnded ? Math.max(...ends) - start : undefined,
        llmCalls: states.reduce((sum, s) => sum + (s?.llmCalls ?? 0), 0),
        lastLog,
        problems: nodes.flatMap((n, i) => {
          const status = statuses[i]!;
          return status === "failed" || status === "skipped"
            ? [{ nodeId: n.id, label: n.label, status, reason: states[i]?.error || status }]
            : [];
        }),
        finished,
      },
    ];
  });
}

/** What is happening now: the phase that is running and the steps in it that are running. */
export function currentStep(phases: PhaseView[], live: Record<string, NodeLive>): { phase?: string; tools: string[] } {
  const active = phases.find((p) => p.status === "running");
  if (!active) return { tools: [] };
  return { phase: active.label, tools: active.nodes.filter((n) => live[n.id]?.status === "running").map((n) => n.label) };
}

const MAX_TOOLS = 3;

/** The running step as one line: the phase, then the steps running in it (the first few). */
export function nowLabel({ phase, tools }: { phase?: string; tools: string[] }): string {
  if (!phase) return "Working";
  if (!tools.length) return phase;
  const more = tools.length > MAX_TOOLS ? ` +${tools.length - MAX_TOOLS}` : "";
  return `${phase}: ${tools.slice(0, MAX_TOOLS).join(", ")}${more}`;
}
