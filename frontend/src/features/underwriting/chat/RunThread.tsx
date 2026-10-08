import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getApi } from "../../../api/client";
import type { Decision, GraphSpec, RunSummary, UnderwritingReport } from "../../../api/types";
import { Badge } from "../../../components/ui/Badge";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { Spinner } from "../../../components/ui/Spinner";
import { DECISION_LABEL, DECISION_STYLE, formatCost, formatTokens, pctRange } from "../../../lib/format";
import { runElapsed } from "../elapsed";
import { groupPhases } from "../phases";
import type { RunStream } from "../reduceEvents";
import { useNow } from "../useNow";
import { PhaseBlock } from "./PhaseBlock";

function ProgramMessage({ run }: { run: RunSummary }) {
  const p = run.program;
  const extras = [p.drug_name, p.modality?.replace(/_/g, " "), p.stage?.replace(/_/g, " "), p.route]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ml-auto max-w-[85%] rounded-lg bg-slate-100 px-4 py-3 text-[0.95rem]">
      <div className="font-medium">{p.indication}</div>
      <div>{p.mechanism}</div>
      {extras && <div className="mt-1 text-xs text-muted">{extras}</div>}
      <div className="mt-1 text-xs text-muted">
        effort {run.options.effort}
        {run.options.model ? ` · ${run.options.model}` : ""}
      </div>
    </div>
  );
}

function UsageLine({ stream }: { stream: RunStream }) {
  const u = stream.usage;
  if (u.calls === 0) return null;
  const tokens = u.tokensIn + u.tokensOut;
  return (
    <p className="text-xs text-muted" aria-live="off">
      {u.calls} model call{u.calls === 1 ? "" : "s"}
      {u.cached > 0 ? ` (${u.cached} cached)` : ""} · {formatTokens(tokens)} tokens ·{" "}
      {u.mock ? "mock model, no spend" : formatCost(u.costUsd)}
    </p>
  );
}

function VerdictCard({
  decision,
  report,
  onOpenReport,
}: {
  decision: Decision;
  report: UnderwritingReport | undefined;
  onOpenReport: () => void;
}) {
  const reasons = report?.verdict.reason_codes.slice(0, 3) ?? [];
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`px-3 py-1 text-sm ${DECISION_STYLE[decision]}`}>{DECISION_LABEL[decision]}</Badge>
        {report && (
          <span className="text-sm text-muted">
            Probability of success <strong className="text-ink">{pctRange(report.pos)}</strong>
          </span>
        )}
      </div>
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reasons.map((r) => (
            <li key={r.code} className="flex items-start gap-2 text-sm">
              <span className={r.direction === "positive" ? "text-emerald-600" : "text-red-600"} aria-hidden="true">
                {r.direction === "positive" ? "▲" : "▼"}
              </span>
              <span>
                <span className="sr-only">{r.direction}: </span>
                {r.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onOpenReport}
        className="mt-3 rounded-full border border-line px-3 py-1 text-sm font-medium text-brand hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Open report
      </button>
    </div>
  );
}

export function RunThread({
  run,
  spec,
  stream,
  decision,
  report,
  onOpenReport,
  onReconnect,
}: {
  run: RunSummary;
  spec: GraphSpec;
  stream: RunStream;
  decision: Decision | undefined;
  report: UnderwritingReport | undefined;
  onOpenReport: () => void;
  onReconnect: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phases = useMemo(() => groupPhases(spec, stream.nodes), [spec, stream.nodes]);
  const total = phases.reduce((n, p) => n + p.nodes.length, 0);
  const finished = phases.reduce((n, p) => n + p.finished, 0);
  const reused = Object.values(stream.nodes).filter((n) => n.status === "reused").length;
  const active = phases.find((p) => p.status === "running");
  const now = useNow(stream.status === "running" || stream.status === "queued");
  const elapsed = runElapsed(stream, now);
  const lost = stream.connection === "closed" && (stream.status === "running" || stream.status === "queued");

  const rerun = useMutation({
    mutationFn: async () => (await getApi()).createRun({ program: run.program, options: run.options }),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/underwriting/runs/${next.id}`);
    },
  });

  return (
    <div className="@container space-y-6">
      <ProgramMessage run={run} />
      <div className="space-y-3">
        {run.parent_run_id && (
          <p className="rounded-md bg-violet-50 p-2 text-xs text-violet-800">
            Re-run of <Link className="underline" to={`/underwriting/runs/${run.parent_run_id}`}>the previous version</Link>{" "}
            after a correction{stream.status !== "queued" ? `: ${reused} steps reused, the rest recompute` : ""}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium" role="status">
          {(stream.status === "running" || stream.status === "queued") && <Spinner />}
          {stream.status === "completed" && <span className="text-emerald-600">✓</span>}
          {stream.status === "failed" && <span className="text-red-600">✕</span>}
          <span className="min-w-0">
            {stream.status === "queued" && "Waiting for a free slot"}
            {stream.status === "running" && `${active?.label ?? "Working"} (${finished}/${total} steps)${elapsed ? ` · ${elapsed}` : ""}`}
            {stream.status === "completed" && `Analysis complete (${total} steps)${elapsed ? ` · ${elapsed}` : ""}`}
            {stream.status === "failed" && `The run failed${elapsed ? ` after ${elapsed}` : ""}`}
          </span>
          {stream.stubData && <Badge className="border-amber-300 bg-amber-50 text-amber-800">stub data</Badge>}
        </div>
        <UsageLine stream={stream} />
        {stream.connection === "connecting" && stream.status === "running" && (
          <p role="status" className="text-xs text-amber-700">Reconnecting to the live stream…</p>
        )}
        {lost && (
          <p role="alert" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            Lost the live stream. The run may still be going on the server.{" "}
            <button type="button" onClick={onReconnect} className="font-medium underline">
              Reconnect
            </button>
          </p>
        )}
        {stream.error && (
          <div className="space-y-2">
            <ErrorBox error={new Error(stream.error)} title="The run failed" />
            <button
              type="button"
              onClick={() => rerun.mutate()}
              disabled={rerun.isPending}
              className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-brand hover:border-brand disabled:opacity-60"
            >
              Run again with the same input
            </button>
            {rerun.error && <ErrorBox error={rerun.error} title="Could not restart" />}
          </div>
        )}
        <ol className="space-y-1.5">
          {phases.map((phase) => (
            <PhaseBlock key={phase.id} phase={phase} live={stream.nodes} />
          ))}
        </ol>
        {decision && <VerdictCard decision={decision} report={report} onOpenReport={onOpenReport} />}
        {run.status === "failed" && !stream.error && run.error && (
          <ErrorBox error={new Error(run.error)} title="The run failed" />
        )}
      </div>
    </div>
  );
}
