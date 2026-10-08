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

export interface Usage {
  calls: number;
  cached: number;
  tokensIn: number;
  tokensOut: number;
  /** null once any paid call had no known price: never guess a cost */
  costUsd: number | null;
  mock: boolean;
}

export interface RunStream {
  connection: "connecting" | "open" | "closed";
  status: "queued" | "running" | "completed" | "failed";
  events: RunEvent[];
  lastSeq: number;
  nodes: Record<string, NodeLive>;
  decision?: string;
  error?: string;
  usage: Usage;
  /** a stub node wrote FIXTURE: placeholder text, so this run carries synthetic data */
  stubData: boolean;
}

export const initialStream: RunStream = {
  connection: "connecting",
  status: "queued",
  events: [],
  lastSeq: 0,
  nodes: {},
  usage: { calls: 0, cached: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, mock: false },
  stubData: false,
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
      if (String(data.message ?? "").includes("FIXTURE:")) next.stubData = true;
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
    case "llm.call": {
      touch((n) => ({ ...n, llmCalls: n.llmCalls + 1 }));
      const cached = data.cached === true;
      const cost = typeof data.cost_usd === "number" ? data.cost_usd : null;
      const u = state.usage;
      next.usage = {
        calls: u.calls + 1,
        cached: u.cached + (cached ? 1 : 0),
        tokensIn: u.tokensIn + (cached ? 0 : Number(data.tokens_in ?? 0)),
        tokensOut: u.tokensOut + (cached ? 0 : Number(data.tokens_out ?? 0)),
        costUsd: cached ? u.costUsd : cost === null || u.costUsd === null ? null : u.costUsd + cost,
        mock: u.mock || String(data.model ?? "").startsWith("mock/"),
      };
      break;
    }
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
