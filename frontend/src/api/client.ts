import type {
  ChatMessage,
  CorrectionRequest,
  CreateRunRequest,
  EvidenceDetail,
  GraphSpec,
  HealthStatus,
  ModelInfo,
  NodeExecution,
  ReportDiff,
  RunDetail,
  RunEvent,
  RunSummary,
  UnderwritingReport,
} from "./types";
import { TERMINAL_EVENTS } from "./types";

export type StreamState = "connecting" | "open" | "closed";

export interface Api {
  health(): Promise<HealthStatus>;
  graph(): Promise<GraphSpec>;
  models(): Promise<ModelInfo[]>;
  listRuns(): Promise<RunSummary[]>;
  createRun(body: CreateRunRequest): Promise<RunSummary>;
  getRun(runId: string): Promise<RunDetail>;
  getReport(runId: string): Promise<UnderwritingReport>;
  getNode(runId: string, nodeId: string): Promise<NodeExecution>;
  createCorrection(runId: string, nodeId: string, body: CorrectionRequest): Promise<RunSummary>;
  getDiff(fromRun: string, toRun: string): Promise<ReportDiff>;
  getEvidence(evidenceId: string): Promise<EvidenceDetail>;
  /** Follow-up question about a run. The backend answers 501 until Stage 3U. */
  postMessage(runId: string, message: ChatMessage): Promise<ChatMessage>;
  /** Replays the full history, then streams live. Returns an unsubscribe function. */
  subscribe(
    runId: string,
    onEvent: (event: RunEvent) => void,
    onState: (state: StreamState) => void,
  ): () => void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string; details?: ApiError["details"] } } = {};
    try {
      body = await response.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? "http_error",
      body.error?.message ?? response.statusText,
      body.error?.details ?? [],
    );
  }
  return response.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const liveApi: Api = {
  health: () => request("/health"),
  graph: () => request("/graph"),
  models: () => request("/models"),
  listRuns: () => request("/runs?limit=100"),
  createRun: (body) => post("/runs", body),
  getRun: (id) => request(`/runs/${id}`),
  getReport: (id) => request(`/runs/${id}/report`),
  getNode: (id, nodeId) => request(`/runs/${id}/nodes/${nodeId}`),
  createCorrection: (id, nodeId, body) => post(`/runs/${id}/nodes/${nodeId}/corrections`, body),
  getDiff: (from, to) => request(`/runs/${from}/diff/${to}`),
  getEvidence: (id) => request(`/evidence/${id}`),
  postMessage: (id, message) => post(`/runs/${id}/messages`, message),
  subscribe(runId, onEvent, onState) {
    // EventSource reconnects by itself and sends Last-Event-ID; the server resumes after it
    const source = new EventSource(`/api/runs/${runId}/events`);
    onState("connecting");
    source.onopen = () => onState("open");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      onEvent(event);
      if (TERMINAL_EVENTS.has(event.type)) {
        source.close();
        onState("closed");
      }
    };
    source.onerror = () => onState(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    return () => source.close();
  },
};

/** The trace download exists only on the real backend. */
export const traceUrl = (runId: string): string | null =>
  import.meta.env.VITE_API_MODE === "mock" ? null : `/api/runs/${runId}/trace`;

let cached: Promise<Api> | undefined;

/** Mock mode lazily loads the fixtures so the live bundle stays small. */
export function getApi(): Promise<Api> {
  cached ??=
    import.meta.env.VITE_API_MODE === "mock"
      ? import("./mock").then((m) => m.mockApi)
      : Promise.resolve(liveApi);
  return cached;
}

export function subscribeToRun(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onState: (state: StreamState) => void,
): () => void {
  let cancelled = false;
  let close = () => {};
  void getApi().then((api) => {
    if (!cancelled) close = api.subscribe(runId, onEvent, onState);
  });
  return () => {
    cancelled = true;
    close();
  };
}
