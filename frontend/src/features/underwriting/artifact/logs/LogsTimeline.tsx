import { useMemo, useState } from "react";
import { traceUrl } from "../../../../api/client";
import type { RunEvent } from "../../../../api/types";
import { humanize, relativeMs } from "../../../../lib/format";

function describe(event: RunEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case "node.log":
      return String(d.message ?? "");
    case "llm.call":
      return `${String(d.model)} · ${String(d.purpose)} · ${Number(d.tokens_in)}/${Number(d.tokens_out)} tokens${d.cached ? " · cached" : ""}`;
    case "node.completed":
      return `done in ${(Number(d.duration_ms ?? 0) / 1000).toFixed(1)}s`;
    case "node.reused":
      return `reused from ${String(d.from_run ?? "parent")}`;
    case "node.failed":
      return String(d.error ?? "failed");
    case "node.skipped":
      return String(d.message ?? d.reason ?? "skipped");
    case "run.completed":
      return `decision: ${String(d.decision ?? "")}`;
    case "run.failed":
      return String(d.error ?? "");
    default:
      return "";
  }
}

const TYPE_STYLE: Record<string, string> = {
  "node.failed": "text-red-600",
  "run.failed": "text-red-600",
  "node.skipped": "text-amber-600",
  "node.reused": "text-violet-600",
  "run.completed": "text-emerald-600",
  "node.completed": "text-emerald-600",
};

export function LogsTimeline({ events, runId }: { events: RunEvent[]; runId: string }) {
  const [node, setNode] = useState("");
  const nodes = useMemo(() => [...new Set(events.flatMap((e) => (e.node_id ? [e.node_id] : [])))], [events]);
  const shown = node ? events.filter((e) => e.node_id === node) : events;
  const first = events[0]?.ts;

  const download = traceUrl(runId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-2 text-sm">
        <label className="flex items-center gap-2">
          Node
          <select className="rounded border border-line px-1 py-0.5" value={node} onChange={(e) => setNode(e.target.value)}>
            <option value="">all</option>
            {nodes.map((n) => (
              <option key={n} value={n}>
                {humanize(n)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted">{shown.length} events</span>
        {download && (
          <a className="ml-auto text-brand hover:underline" href={download} download>
            Download trace (JSON)
          </a>
        )}
      </div>
      <ol className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">
        {shown.length === 0 && <li className="text-muted">Waiting for events…</li>}
        {shown.map((e) => (
          <li key={e.seq} className="grid grid-cols-[3.5rem_5rem_11rem_8rem_1fr] gap-2 border-b border-line py-0.5">
            <span className="text-muted">#{e.seq}</span>
            <span className="text-muted">{first ? relativeMs(first, e.ts) : ""}</span>
            <span className="truncate">{e.node_id ?? "run"}</span>
            <span className={TYPE_STYLE[e.type] ?? "text-muted"}>{e.type}</span>
            <span className="break-words">{describe(e)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
