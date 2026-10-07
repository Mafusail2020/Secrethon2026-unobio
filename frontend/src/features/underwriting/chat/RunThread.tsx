import { useState } from "react";
import { Link } from "react-router-dom";
import type { GraphSpec, RunSummary } from "../../../api/types";
import { Badge } from "../../../components/ui/Badge";
import { Spinner } from "../../../components/ui/Spinner";
import { DECISION_LABEL, DECISION_STYLE, humanize } from "../../../lib/format";
import { runnableNodes } from "../graphUtils";
import type { RunStream } from "../reduceEvents";
import { STATUS_ICON, STATUS_TEXT } from "../status";

function ProgramMessage({ run }: { run: RunSummary }) {
  const p = run.program;
  const extras = [p.drug_name, p.modality?.replace(/_/g, " "), p.stage?.replace(/_/g, " "), p.route]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ml-8 rounded-lg bg-navy p-3 text-sm text-white">
      <div className="font-medium">{p.indication}</div>
      <div>{p.mechanism}</div>
      {extras && <div className="mt-1 text-xs opacity-80">{extras}</div>}
      <div className="mt-1 text-xs opacity-70">
        effort {run.options.effort}
        {run.options.model ? ` · ${run.options.model}` : ""}
      </div>
    </div>
  );
}

function Step({ id, label, stream }: { id: string; label: string; stream: RunStream }) {
  const [open, setOpen] = useState(false);
  const node = stream.nodes[id];
  const status = node?.status ?? "pending";
  const last = node?.logs.at(-1)?.message;
  return (
    <li className="rounded-md border border-line bg-white">
      <button
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`mt-0.5 w-4 text-center ${STATUS_TEXT[status]}`}>
          {status === "running" ? <Spinner className="h-3 w-3" /> : STATUS_ICON[status]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{label}</span>
          {node?.llmCalls ? <Badge className="ml-2 border-slate-300 text-slate-600">{node.llmCalls} llm</Badge> : null}
          {last && status !== "done" && <span className="block truncate text-xs text-muted">{last}</span>}
          {status === "reused" && <span className="block text-xs text-violet-600">reused from the parent run</span>}
          {node?.error && <span className="block text-xs text-red-600">{node.error}</span>}
        </span>
        {node?.durationMs ? <span className="text-xs text-muted">{(node.durationMs / 1000).toFixed(1)}s</span> : null}
      </button>
      {open && node && (
        <ul className="border-t border-line bg-canvas px-3 py-1.5 text-xs text-muted">
          {node.logs.length === 0 && <li>no log lines</li>}
          {node.logs.map((l) => (
            <li key={l.seq} className={l.level === "error" ? "text-red-600" : l.level === "warn" ? "text-amber-600" : ""}>
              {l.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function RunThread({
  run,
  spec,
  stream,
  decision,
  onOpenReport,
}: {
  run: RunSummary;
  spec: GraphSpec;
  stream: RunStream;
  decision: keyof typeof DECISION_LABEL | undefined;
  onOpenReport: () => void;
}) {
  const nodes = runnableNodes(spec);
  const started = nodes.filter((n) => stream.nodes[n.id]);
  const finished = nodes.filter((n) => ["done", "reused", "skipped", "failed"].includes(stream.nodes[n.id]?.status ?? ""));
  const reused = nodes.filter((n) => stream.nodes[n.id]?.status === "reused").length;

  return (
    <div className="space-y-3 p-3">
      <ProgramMessage run={run} />
      <div className="mr-4 space-y-2 rounded-lg border border-line bg-canvas p-3">
        {run.parent_run_id && (
          <div className="rounded-md bg-violet-50 p-2 text-xs text-violet-800">
            Re-run of <Link className="underline" to={`/underwriting/runs/${run.parent_run_id}`}>the previous version</Link> after a
            correction{stream.status !== "queued" ? `: ${reused} nodes reused, the rest recompute` : ""}.
          </div>
        )}
        <div className="flex items-center gap-2 text-sm font-medium">
          {stream.status === "running" || stream.status === "queued" ? <Spinner /> : null}
          {stream.status === "completed" && <span className="text-emerald-600">✓</span>}
          {stream.status === "failed" && <span className="text-red-600">✕</span>}
          <span>
            {stream.status === "queued" && "Waiting for a free slot"}
            {stream.status === "running" && `Researching and analysing (${finished.length}/${nodes.length})`}
            {stream.status === "completed" && `Analysis complete (${finished.length}/${nodes.length} steps)`}
            {stream.status === "failed" && "Run failed"}
          </span>
        </div>
        {stream.error && <div className="text-sm text-red-700">{stream.error}</div>}
        {stream.connection === "connecting" && stream.status === "running" && (
          <div className="text-xs text-amber-600">Reconnecting to the live stream…</div>
        )}
        <ul className="space-y-1">
          {started.map((n) => (
            <Step key={n.id} id={n.id} label={n.label} stream={stream} />
          ))}
        </ul>
        {started.length < nodes.length && stream.status === "running" && (
          <div className="text-xs text-muted">{nodes.length - started.length} steps pending</div>
        )}
        {decision && (
          <div className="flex items-center justify-between rounded-md border border-line bg-white p-2">
            <Badge className={DECISION_STYLE[decision]}>{DECISION_LABEL[decision]}</Badge>
            <button className="text-sm font-medium text-brand hover:underline" onClick={onOpenReport}>
              Open report
            </button>
          </div>
        )}
        {run.status === "failed" && !stream.error && run.error && <div className="text-sm text-red-700">{humanize(run.error)}</div>}
      </div>
    </div>
  );
}
