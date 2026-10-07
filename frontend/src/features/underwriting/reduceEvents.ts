import type { NodeStatus, RunEvent } from "../../api/types";

export interface LogEntry {
  seq: number;
  ts: string;
  level: string;
  message: string;
}

export interface NodeLive {
  status: NodeStatus;
  startedAt?: string;
  durationMs?: number;
  logs: LogEntry[];
  llmCalls: number;
  error?: string;
}

export interface RunStream {
  connection: "connecting" | "open" | "closed";
  status: "queued" | "running" | "completed" | "failed";
  events: RunEvent[];
  lastSeq: number;
  nodes: Record<string, NodeLive>;
  decision?: string;
  error?: string;
}

export const initialStream: RunStream = {
  connection: "connecting",
  status: "queued",
  events: [],
  lastSeq: 0,
  nodes: {},
};

const blank = (): NodeLive => ({ status: "pending", logs: [], llmCalls: 0 });

export function applyEvent(state: RunStream, event: RunEvent): RunStream {
  // reconnects replay history; ignore what we already have
  if (event.seq <= state.lastSeq) return state;
  const next: RunStream = {
    ...state,
    events: [...state.events, event],
    lastSeq: event.seq,
    nodes: { ...state.nodes },
  };
  const touch = (update: (n: NodeLive) => NodeLive) => {
    if (!event.node_id) return;
    next.nodes[event.node_id] = update(next.nodes[event.node_id] ?? blank());
  };
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case "run.started":
      next.status = "running";
      break;
    case "node.started":
      touch((n) => ({ ...n, status: "running", startedAt: event.ts }));
      break;
    case "node.log":
      touch((n) => ({
        ...n,
        logs: [
          ...n.logs,
          {
            seq: event.seq,
            ts: event.ts,
            level: String(data.level ?? "info"),
            message: String(data.message ?? ""),
          },
        ],
      }));
      break;
    case "llm.call":
      touch((n) => ({ ...n, llmCalls: n.llmCalls + 1 }));
      break;
    case "node.completed":
      touch((n) => ({ ...n, status: "done", durationMs: Number(data.duration_ms ?? 0) }));
      break;
    case "node.reused":
      touch((n) => ({ ...n, status: "reused" }));
      break;
    case "node.skipped":
      touch((n) => ({ ...n, status: "skipped", error: String(data.message ?? data.reason ?? "") }));
      break;
    case "node.failed":
      touch((n) => ({ ...n, status: "failed", error: String(data.error ?? "") }));
      break;
    case "run.completed":
      next.status = "completed";
      next.decision = typeof data.decision === "string" ? data.decision : undefined;
      break;
    case "run.failed":
      next.status = "failed";
      next.error = String(data.error ?? "run failed");
      break;
  }
  return next;
}
