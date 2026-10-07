import eventsRaw from "../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../contracts/fixtures/graph_spec.json";
import reportJson from "../../../../contracts/fixtures/report_bace1_alzheimers.json";
import { affectedSet, runnableNodes } from "../../features/underwriting/graphUtils";
import { ApiError, type Api, type StreamState } from "../client";
import type {
  CorrectionRequest,
  CreateRunRequest,
  GraphSpec,
  LLMCall,
  NodeExecution,
  RunEvent,
  RunSummary,
  UnderwritingReport,
} from "../types";
import { TERMINAL_EVENTS } from "../types";

// Mirrors the backend stub run closely enough to demo with no server:
// fixture events replayed with delays, corrections reuse nodes outside the affected set.

const spec = graphSpecJson as GraphSpec;
const baseReport = reportJson as unknown as UnderwritingReport;
const fixtureEvents = eventsRaw
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RunEvent);
const STEP_MS = 40;

type Draft = Pick<RunEvent, "type" | "node_id" | "data">;

interface MockRun {
  summary: RunSummary;
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  corrections: { id: string; run_id: string; node_id: string; text: string }[];
  reused: Set<string>;
  report?: UnderwritingReport;
}

const runs = new Map<string, MockRun>();
let counter = 0;

const flips = (run: MockRun) => run.corrections.some((c) => /terminated/i.test(c.text));

function draftsFor(run: MockRun): Draft[] {
  const seenReused = new Set<string>();
  const out: Draft[] = [];
  for (const event of fixtureEvents) {
    const id = event.node_id;
    if (id && run.reused.has(id)) {
      if (event.type === "node.started" && !seenReused.has(id)) {
        seenReused.add(id);
        out.push({ type: "node.reused", node_id: id, data: { from_run: run.summary.parent_run_id } });
      }
      continue;
    }
    const data =
      event.type === "run.started"
        ? { ...event.data, parent_run_id: run.summary.parent_run_id, reused: [...run.reused] }
        : event.type === "run.completed"
          ? { decision: flips(run) ? "do_not_invest" : "conditional" }
          : event.data;
    out.push({ type: event.type, node_id: id, data });
  }
  return out;
}

function buildReport(run: MockRun): UnderwritingReport {
  const report = structuredClone(baseReport);
  const last = run.corrections.at(-1);
  report.run_id = run.summary.id;
  report.program = run.summary.program;
  report.meta = {
    ...report.meta,
    created_at: run.summary.created_at,
    parent_run_id: run.summary.parent_run_id ?? null,
    correction_id: run.summary.parent_run_id ? (last?.id ?? null) : null,
  };
  if (flips(run)) {
    report.verdict = {
      ...report.verdict,
      decision: "do_not_invest",
      confidence: "medium",
      conditions: [],
      rationale: "FIXTURE: decision changed after a correction about a terminated program",
    };
  }
  return report;
}

function push(run: MockRun, draft: Draft) {
  const event: RunEvent = {
    ...draft,
    seq: run.events.length + 1,
    run_id: run.summary.id,
    ts: new Date().toISOString(),
  };
  run.events.push(event);
  if (event.type === "run.started") run.summary.status = "running";
  if (event.type === "run.completed") {
    run.report = buildReport(run);
    run.summary.status = "completed";
    run.summary.decision = run.report.verdict.decision;
  }
  run.listeners.forEach((listener) => listener(event));
}

function start(run: MockRun) {
  const drafts = draftsFor(run);
  let index = 0;
  const tick = () => {
    const draft = drafts[index++];
    if (!draft) return;
    push(run, draft);
    setTimeout(tick, STEP_MS);
  };
  setTimeout(tick, STEP_MS);
}

function create(body: CreateRunRequest, parent?: MockRun, correction?: MockRun["corrections"][0]) {
  const id = `run_mock_${++counter}`;
  const affected = correction ? affectedSet(spec, correction.node_id) : new Set<string>();
  const run: MockRun = {
    summary: {
      id,
      status: "queued",
      program: body.program,
      options: { effort: "medium", ...body.options },
      created_at: new Date().toISOString(),
      parent_run_id: parent?.summary.id ?? null,
      decision: null,
      error: null,
    } as RunSummary,
    events: [],
    listeners: new Set(),
    corrections: [...(parent?.corrections ?? []), ...(correction ? [correction] : [])],
    reused: parent
      ? new Set(runnableNodes(spec).filter((n) => !affected.has(n.id)).map((n) => n.id))
      : new Set(),
  };
  runs.set(id, run);
  start(run);
  return run;
}

const need = (runId: string): MockRun => {
  const run = runs.get(runId);
  if (!run) throw new ApiError(404, "run_not_found", `no run ${runId}`);
  return run;
};

function executionOf(run: MockRun, nodeId: string): NodeExecution | undefined {
  const events = run.events.filter((e) => e.node_id === nodeId);
  if (!events.length) return undefined;
  const has = (type: RunEvent["type"]) => events.find((e) => e.type === type);
  const status = has("node.reused")
    ? "reused"
    : has("node.completed")
      ? "done"
      : has("node.failed")
        ? "failed"
        : "running";
  return {
    run_id: run.summary.id,
    node_id: nodeId,
    status,
    started_at: has("node.started")?.ts ?? has("node.reused")?.ts ?? null,
    finished_at: has("node.completed")?.ts ?? has("node.reused")?.ts ?? null,
    input_summary: {},
    output: (has("node.completed")?.data as { output?: Record<string, unknown> })?.output ?? {},
    log: events
      .filter((e) => e.type === "node.log")
      .map((e) => ({
        ts: e.ts,
        level: String(e.data.level ?? "info") as "info",
        message: String(e.data.message ?? ""),
      })),
    source_ids: [],
    llm_calls: events.filter((e) => e.type === "llm.call").map((e) => e.data as unknown as LLMCall),
    cost_usd: null,
    error: null,
    correction_ids: run.corrections.filter((c) => c.node_id === nodeId).map((c) => c.id),
  };
}

const wait = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 30));

export const mockApi: Api = {
  graph: () => wait(spec),
  models: () =>
    wait([
      {
        id: "gpt-6-luna",
        label: "GPT-6 Luna (mock)",
        tier: "unknown",
        available: true,
        default: true,
        price_in_per_mtok: null,
        price_out_per_mtok: null,
      },
    ]),
  listRuns: () =>
    wait(
      [...runs.values()]
        .map((r) => ({ ...r.summary }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    ),
  createRun: (body) => wait({ ...create(body).summary }),
  getRun: (id) => {
    const run = need(id);
    const nodes = runnableNodes(spec).flatMap((n) => {
      const e = executionOf(run, n.id);
      return e ? [{ ...e, log: [], llm_calls: [] }] : [];
    });
    return wait({ summary: { ...run.summary }, nodes, report: run.report ?? null });
  },
  getReport: (id) => {
    const run = need(id);
    if (!run.report) throw new ApiError(409, "report_not_ready", `run ${id} has no report`);
    return wait(run.report);
  },
  getNode: (id, nodeId) => {
    const execution = executionOf(need(id), nodeId);
    if (!execution) throw new ApiError(404, "node_not_found", `node ${nodeId} has not run`);
    return wait(execution);
  },
  createCorrection: (id, nodeId, body: CorrectionRequest) => {
    const parent = need(id);
    if (parent.summary.status !== "completed") {
      throw new ApiError(409, "run_not_completed", "corrections need a completed parent run");
    }
    const entry = spec.nodes.find((n) => n.id === nodeId);
    if (!entry) throw new ApiError(404, "node_not_found", `no node ${nodeId}`);
    if (!entry.correctable) throw new ApiError(422, "node_not_correctable", `${nodeId} cannot be corrected`);
    const correction = { id: `cor_mock_${counter + 1}`, run_id: id, node_id: nodeId, text: body.text };
    const child = create({ program: parent.summary.program, options: parent.summary.options }, parent, correction);
    return wait({ ...child.summary });
  },
  getDiff: (from, to) => {
    const before = need(from);
    const after = need(to);
    if (!before.report || !after.report) {
      throw new ApiError(409, "run_not_completed", "both runs need a report");
    }
    return wait({
      from_run: from,
      to_run: to,
      decision_before: before.report.verdict.decision,
      decision_after: after.report.verdict.decision,
      pos_before: before.report.pos,
      pos_after: after.report.pos,
      changed_sections: [],
      added_claim_ids: [],
      removed_claim_ids: [],
      recomputed_nodes: runnableNodes(spec)
        .map((n) => n.id)
        .filter((n) => !after.reused.has(n)),
    });
  },
  getEvidence: (evidenceId) => {
    const evidence = baseReport.evidence[evidenceId];
    const source = evidence && baseReport.sources[evidence.source_id];
    if (!evidence || !source) throw new ApiError(404, "evidence_not_found", `no evidence ${evidenceId}`);
    return wait({ evidence, source });
  },
  postMessage: (runId, message) => {
    const report = need(runId).report;
    if (!report) throw new ApiError(409, "run_not_completed", "the run has no report yet");
    // canned: point at the claims behind the verdict, which is what a real answer would cite
    const cited = report.verdict.reason_codes.flatMap((r) => r.claim_ids).slice(0, 3);
    return wait({
      role: "assistant",
      run_id: runId,
      content: `Mock reply to "${message.content.slice(0, 80)}". The claims below are the ones the verdict rests on.`,
      cited_claim_ids: cited,
    });
  },
  subscribe(runId, onEvent, onState) {
    const run = need(runId);
    let open = true;
    const listener = (event: RunEvent) => {
      if (!open) return;
      onEvent(event);
      if (TERMINAL_EVENTS.has(event.type)) onState("closed");
    };
    onState("open" satisfies StreamState);
    // replay synchronously, then go live: JS is single-threaded, so nothing falls in between
    run.events.forEach(listener);
    if (open) run.listeners.add(listener);
    return () => {
      open = false;
      run.listeners.delete(listener);
    };
  },
};
