import eventsRaw from "../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../contracts/fixtures/graph_spec.json";
import reportJson from "../../../../contracts/fixtures/report_bace1_alzheimers.json";
import { affectedSet, runnableNodes } from "../../features/underwriting/graphUtils";
import { ApiError, type Api, type StreamState } from "../client";
import { mockDeckScript } from "./deckScript";
import type {
  ChatMessage,
  CorrectionRequest,
  CreateRunRequest,
  DeckScript,
  DocumentInfo,
  GraphSpec,
  LLMCall,
  NodeExecution,
  RunEvent,
  RunSummary,
  UnderwritingReport,
} from "../types";
import { TERMINAL_EVENTS } from "../types";
import { briefing } from "./briefing";
import { adjustDrafts, adjustReport, scenarioFromSearch, stepDelayFactor, type Draft, type Scenario } from "./scenarios";

// Mirrors the backend stub run closely enough to demo with no server:
// fixture events replayed with delays, corrections reuse nodes outside the affected set.

const spec = graphSpecJson as GraphSpec;
const baseReport = reportJson as unknown as UnderwritingReport;
const fixtureEvents = eventsRaw
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RunEvent);
const STEP_MS = 40;

interface MockRun {
  summary: RunSummary;
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  corrections: { id: string; run_id: string; node_id: string; text: string }[];
  reused: Set<string>;
  scenario?: Scenario;
  report?: UnderwritingReport;
  chat: ChatMessage[];
  readout?: ChatMessage;
}

const runs = new Map<string, MockRun>();
const documents = new Map<string, DocumentInfo>();
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
          : event.type === "llm.call"
            ? { ...event.data, model: "mock/gpt-6-luna", cost_usd: 0 }
            : event.data;
    out.push({ type: event.type, node_id: id, data });
  }
  return adjustDrafts(out, run.scenario);
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
  for (const id of run.summary.program.document_ids ?? []) {
    const info = documents.get(id);
    if (!info) continue;
    const sourceId = `src_${id.slice(4)}`;
    report.sources[sourceId] = {
      id: sourceId,
      type: "user_provided",
      title: `User document: ${info.name}`,
      url: null,
      publisher: "You",
      published_at: null,
      retrieved_at: run.summary.created_at,
      identifiers: { document: id, chunks: "1" },
    };
    const evidenceId = `ev_${id.slice(4)}`;
    report.evidence[evidenceId] = {
      id: evidenceId,
      source_id: sourceId,
      excerpt: `FIXTURE: text read from ${info.name}`,
      locator: "p. 1",
      entity_ids: [],
      kind: "text",
      data: null,
    };
  }
  if (flips(run)) {
    report.verdict = {
      ...report.verdict,
      decision: "do_not_invest",
      confidence: "medium",
      conditions: [],
      rationale: "FIXTURE: decision changed after a correction about a terminated program",
    };
  }
  if (run.summary.options.effort === "panel") {
    const size = run.summary.options.panel_size ?? 3;
    report.meta = { ...report.meta, effort: "panel", panel_size: size };
    for (const section of Object.values(report.sections)) {
      section.panel = {
        candidates: [1, 2].map((i) => ({
          model: `mock/gpt-6-luna#${i}`,
          summary: `FIXTURE: mock candidate ${i} for ${section.title}`,
          decision_hint: i === 1 ? "conditional" : "do_not_invest",
        })),
        consensus: `FIXTURE: mock consensus for ${section.title}`,
        disagreements: ["FIXTURE: candidates weigh the terminated trials differently"],
        agreement: 0.72,
      };
    }
  }
  return adjustReport(report, run.scenario);
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
  if (event.type === "run.failed") {
    run.summary.status = "failed";
    run.summary.error = String((event.data as Record<string, unknown>).error ?? "run failed");
  }
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
    setTimeout(tick, STEP_MS * stepDelayFactor(run.scenario));
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
    chat: [],
    listeners: new Set(),
    scenario: parent?.scenario ?? scenarioFromSearch(window.location.search),
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
  health: () => wait({ status: "ok", llm_mode: "mock", llm_cache: true, has_api_key: false, max_panel_size: 4 }),
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
  deleteRun: async (id) => {
    need(id);
    const doomed = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const run of runs.values()) {
        const parent = run.summary.parent_run_id;
        if (parent && doomed.has(parent) && !doomed.has(run.summary.id)) grew = !!doomed.add(run.summary.id);
      }
    }
    if ([...doomed].some((d) => ["queued", "running"].includes(runs.get(d)!.summary.status))) {
      throw new ApiError(409, "run_active", "a run that is still working cannot be deleted");
    }
    for (const d of doomed) runs.delete(d);
    return wait(undefined);
  },
  uploadDocument: async (file) => {
    const kind = /\.pdf$/i.test(file.name) ? "pdf" : /\.(txt|md)$/i.test(file.name) ? "text" : undefined;
    if (!kind) throw new ApiError(415, "unsupported_document", "only PDF, TXT and MD files are accepted");
    if (file.size > 10_000_000) throw new ApiError(413, "document_too_large", `${file.name} is over 10 MB`);
    const seed = [...`${file.name}:${file.size}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const info: DocumentInfo = { id: `doc_${seed.toString(16).padStart(16, "0")}`, name: file.name, kind, size_bytes: file.size };
    documents.set(info.id, info);
    return wait(info);
  },
  postDeck: (id) => {
    const run = need(id);
    if (!run.report) throw new ApiError(409, "run_not_completed", "the run has no report yet");
    const script: DeckScript = mockDeckScript(run.report);
    return wait(script);
  },
  getDocument: (id) => {
    const info = documents.get(id);
    if (!info) throw new ApiError(404, "document_not_found", `no document ${id}`);
    return wait(info);
  },
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
    if (body.document_ids && nodeId !== "ingest_user_input") {
      throw new ApiError(422, "documents_need_ingest", "documents change at ingest_user_input");
    }
    const program = body.document_ids ? { ...parent.summary.program, document_ids: body.document_ids } : parent.summary.program;
    const child = create({ program, options: parent.summary.options }, parent, correction);
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
    // passages of uploaded files exist only in the run that read them
    const holder = [...runs.values()].map((r) => r.report).find((r) => r?.evidence[evidenceId]) ?? baseReport;
    const evidence = holder.evidence[evidenceId];
    const source = evidence && holder.sources[evidence.source_id];
    if (!evidence || !source) throw new ApiError(404, "evidence_not_found", `no evidence ${evidenceId}`);
    return wait({ evidence, source });
  },
  postSummary: (runId) => {
    const run = need(runId);
    if (!run.report) throw new ApiError(409, "run_not_completed", "the run has no report yet");
    if (!run.readout) {
      const { text, cited, passages } = briefing(run.report);
      run.readout = { role: "assistant", run_id: runId, content: text, cited_claim_ids: cited, cited_evidence_ids: passages };
    }
    return wait({ ...run.readout });
  },
  getMessages: (runId) => wait([...need(runId).chat]),
  postMessage: (runId, message) => {
    const run = need(runId);
    if (!run.report) throw new ApiError(409, "run_not_completed", "the run has no report yet");
    const question = message.content.trim();
    if (!question) throw new ApiError(422, "validation_error", "send a question");
    // canned: point at the claims behind the verdict, which is what a real answer would cite
    const cited = run.report.verdict.reason_codes.flatMap((r) => r.claim_ids).slice(0, 3);
    const fileSources = new Set(
      Object.values(run.report.sources)
        .filter((s) => s.identifiers.document)
        .map((s) => s.id),
    );
    const passages = Object.values(run.report.evidence)
      .filter((e) => fileSources.has(e.source_id))
      .map((e) => e.id)
      .slice(0, 2);
    const reply: ChatMessage = {
      role: "assistant",
      run_id: runId,
      content: `Mock reply to "${question.slice(0, 80)}". The claims below are the ones the verdict rests on.`,
      cited_claim_ids: cited,
      cited_evidence_ids: passages,
    };
    run.chat.push({ role: "user", content: question, run_id: runId, cited_claim_ids: [], cited_evidence_ids: [] }, reply);
    return wait(reply);
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
