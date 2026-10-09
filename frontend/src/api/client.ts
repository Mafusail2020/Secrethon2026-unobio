import type {
  ChatMessage,
  CorrectionRequest,
  CreateRunRequest,
  DeckScript,
  DocumentInfo,
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
  /** Keeps a file for the next run; the run names it by the returned id. */
  uploadDocument(file: File): Promise<DocumentInfo>;
  getDocument(documentId: string): Promise<DocumentInfo>;
  /** The words of the committee deck for a finished run, written once. Empty `slides`: use the report's own wording. */
  postDeck(runId: string, rewrite?: boolean): Promise<DeckScript>;
  getRun(runId: string): Promise<RunDetail>;
  getReport(runId: string): Promise<UnderwritingReport>;
  getNode(runId: string, nodeId: string): Promise<NodeExecution>;
  createCorrection(runId: string, nodeId: string, body: CorrectionRequest): Promise<RunSummary>;
  getDiff(fromRun: string, toRun: string): Promise<ReportDiff>;
  getEvidence(evidenceId: string): Promise<EvidenceDetail>;
  /** Earlier follow-up questions and answers of a run, oldest first. */
  getMessages(runId: string): Promise<ChatMessage[]>;
  /** The plain-language read-out of a completed run. Written once; asking again returns the same text. */
  postSummary(runId: string): Promise<ChatMessage>;
  /** Follow-up question about a completed run; the reply cites claims of its report. */
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
  getDocument: (id) => request(`/documents/${id}`),
  postDeck: (id, rewrite) => post(`/runs/${id}/deck${rewrite ? "?rewrite=true" : ""}`, {}),
  // the raw file is the body; its name travels in a header so no multipart parser is needed
  uploadDocument: (file) =>
    request("/documents", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
      body: file,
    }),
  getRun: (id) => request(`/runs/${id}`),
  getReport: (id) => request(`/runs/${id}/report`),
  getNode: (id, nodeId) => request(`/runs/${id}/nodes/${nodeId}`),
  createCorrection: (id, nodeId, body) => post(`/runs/${id}/nodes/${nodeId}/corrections`, body),
  getDiff: (from, to) => request(`/runs/${from}/diff/${to}`),
  getEvidence: (id) => request(`/evidence/${id}`),
  postSummary: (id) => post(`/runs/${id}/summary`, {}),
  getMessages: (id) => request(`/runs/${id}/messages`),
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

/** The uploaded file itself, for a reader to open. The mock has no file behind an id. */
export const documentFileUrl = (documentId: string): string | null =>
  import.meta.env.VITE_API_MODE === "mock" ? null : `/api/documents/${documentId}/file`;

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
