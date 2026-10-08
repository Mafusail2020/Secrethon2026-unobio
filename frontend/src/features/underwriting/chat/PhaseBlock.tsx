import { useState } from "react";
import { Badge } from "../../../components/ui/Badge";
import { Spinner } from "../../../components/ui/Spinner";
import { formatDuration } from "../../../lib/format";
import { STATUS_ICON, STATUS_TEXT } from "../status";
import type { NodeSpec } from "../../../api/types";
import type { PhaseStatus, PhaseView } from "../phases";
import type { NodeLive } from "../reduceEvents";

const PHASE_ICON: Record<PhaseStatus, string> = {
  pending: STATUS_ICON.pending,
  running: STATUS_ICON.running,
  done: STATUS_ICON.done,
  failed: STATUS_ICON.failed,
  degraded: "⚠",
  reused: STATUS_ICON.reused,
};
const PHASE_TEXT: Record<PhaseStatus, string> = {
  pending: STATUS_TEXT.pending,
  running: STATUS_TEXT.running,
  done: STATUS_TEXT.done,
  failed: STATUS_TEXT.failed,
  degraded: STATUS_TEXT.skipped,
  reused: STATUS_TEXT.reused,
};

function Step({ node, live }: { node: NodeSpec; live: NodeLive | undefined }) {
  const [open, setOpen] = useState(false);
  const status = live?.status ?? "pending";
  const last = live?.logs.at(-1)?.message;
  const hasLogs = (live?.logs.length ?? 0) > 0;
  return (
    <li className="text-sm">
      <button
        type="button"
        onClick={() => hasLogs && setOpen((o) => !o)}
        aria-expanded={hasLogs ? open : undefined}
        className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className={`mt-0.5 w-4 shrink-0 text-center ${STATUS_TEXT[status]}`}>
          {status === "running" ? <Spinner className="h-3 w-3" /> : STATUS_ICON[status]}
        </span>
        <span className="min-w-0 flex-1">
          <span className={status === "pending" ? "text-muted" : ""}>{node.label}</span>
          {last && status !== "done" && <span className="block truncate text-xs text-muted">{last}</span>}
          {status === "reused" && <span className="block text-xs text-brand">reused from the previous run</span>}
          {live?.error && <span className="block text-xs text-red-700">{live.error}</span>}
        </span>
        {live?.durationMs ? <span className="shrink-0 text-xs text-muted">{formatDuration(live.durationMs)}</span> : null}
      </button>
      {open && live && (
        <ul className="ml-6 mt-0.5 space-y-0.5 border-l border-line pl-2 text-xs text-muted">
          {live.logs.map((l) => (
            <li key={l.seq} className={l.level === "error" ? "text-red-700" : l.level === "warn" ? "text-amber-700" : ""}>
              {l.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One pipeline phase: a collapsible trace block. Open while it runs or has a problem, closed once done. */
export function PhaseBlock({ phase, live }: { phase: PhaseView; live: Record<string, NodeLive> }) {
  const [override, setOverride] = useState<boolean | undefined>();
  const auto = phase.status === "running" || phase.status === "failed" || phase.status === "degraded";
  const open = override ?? auto;
  const pending = phase.status === "pending";

  return (
    <li className={`rounded-lg border bg-surface ${phase.status === "failed" ? "border-red-300" : "border-line"} ${pending ? "opacity-70" : ""}`}>
      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className={`mt-0.5 w-4 shrink-0 text-center ${PHASE_TEXT[phase.status]}`} aria-hidden="true">
          {phase.status === "running" ? <Spinner className="h-3.5 w-3.5" /> : PHASE_ICON[phase.status]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{phase.label}</span>
          <span className="block truncate text-xs text-muted">
            {phase.status === "pending" ? phase.description : (phase.lastLog ?? phase.description)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted">
          {phase.durationMs !== undefined && <span>{formatDuration(phase.durationMs)}</span>}
          {phase.llmCalls > 0 && <Badge className="border-line text-muted">{phase.llmCalls} llm</Badge>}
          {!pending && phase.finished < phase.nodes.length && (
            <span>
              {phase.finished}/{phase.nodes.length}
            </span>
          )}
        </span>
      </button>

      {phase.problems.length > 0 && (
        <ul className="space-y-0.5 border-t border-line px-2.5 py-1.5 text-xs">
          {phase.problems.map((p) => (
            <li key={p.nodeId} className={p.status === "failed" ? "text-red-700" : "text-amber-700"}>
              <span className="font-medium">{p.label}</span> {p.status}: {p.reason}
            </li>
          ))}
        </ul>
      )}

      {open && !pending && (
        <div className="border-t border-line px-1.5 py-1.5">
          {phase.lanes.length > 0 ? (
            <div className="grid gap-2 @md:grid-cols-2">
              {phase.lanes.map((lane) => (
                <div key={lane.id}>
                  <h4 className="px-1 text-xs font-medium text-muted">{lane.label}</h4>
                  <ul>
                    {lane.nodes.map((n) => (
                      <Step key={n.id} node={n} live={live[n.id]} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul>
              {phase.nodes.map((n) => (
                <Step key={n.id} node={n} live={live[n.id]} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
