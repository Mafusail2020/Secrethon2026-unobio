import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getApi } from "../../../api/client";
import type { ChatMessage, Decision, GraphSpec, RunSummary, UnderwritingReport } from "../../../api/types";
import { Badge } from "../../../components/ui/Badge";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { Spinner } from "../../../components/ui/Spinner";
import { DECISION_LABEL, DECISION_STYLE, formatCost, formatTokens, pctRange } from "../../../lib/format";
import { runElapsed } from "../elapsed";
import { currentStep, groupPhases, nowLabel } from "../phases";
import type { RunStream } from "../reduceEvents";
import { useNow } from "../useNow";
import { MarkdownText } from "./MarkdownText";
import { PhaseBlock } from "./PhaseBlock";
import { WorkTrace } from "./WorkTrace";

export interface SummaryState {
  message: ChatMessage | undefined;
  pending: boolean;
  failed: boolean;
  retry: () => void;
}

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

/** The read-out in plain prose, with the claims it rests on. */
function SummaryBlock({
  summary,
  report,
  onOpenClaim,
}: {
  summary: SummaryState;
  report: UnderwritingReport | undefined;
  onOpenClaim: (claimId: string) => void;
}) {
  if (summary.pending) {
    return (
      <div role="status" aria-busy="true" className="space-y-2.5">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-3.5 w-3.5" /> Writing the summary…
        </p>
        <div className="h-3 w-11/12 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
        <div className="h-3 w-7/12 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      </div>
    );
  }
  if (summary.failed) {
    return (
      <p role="alert" className="text-sm text-red-700">
        Could not write the summary.{" "}
        <button type="button" onClick={summary.retry} className="font-medium underline">
          Try again
        </button>
      </p>
    );
  }
  if (!summary.message) return null;
  const { content, cited_claim_ids: ids } = summary.message;
  return (
    <div className="text-[0.95rem] leading-relaxed">
      <MarkdownText text={content} ids={ids} report={report} onOpenClaim={onOpenClaim} />
      {ids.length > 0 && (
        <details className="mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted">Claims cited ({ids.length})</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {ids.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => onOpenClaim(id)} className="text-left text-brand hover:underline">
                  {report?.claims[id]?.text ?? id}
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
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
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2.5">
      <Badge className={`px-3 py-1 text-sm ${DECISION_STYLE[decision]}`}>{DECISION_LABEL[decision]}</Badge>
      {report && (
        <span className="text-sm text-muted">
          Probability of success <strong className="text-ink">{pctRange(report.pos)}</strong>
        </span>
      )}
      <button
        type="button"
        onClick={onOpenReport}
        className="ml-auto rounded-full border border-line px-3 py-1 text-sm font-medium text-brand hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
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
  summary,
  onOpenReport,
  onOpenClaim = () => {},
  onReconnect,
}: {
  run: RunSummary;
  spec: GraphSpec;
  stream: RunStream;
  decision: Decision | undefined;
  report: UnderwritingReport | undefined;
  /** the plain-language read-out; absent until the run has completed */
  summary?: SummaryState;
  onOpenReport: () => void;
  onOpenClaim?: (claimId: string) => void;
  onReconnect: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phases = useMemo(() => groupPhases(spec, stream.nodes), [spec, stream.nodes]);
  const total = phases.reduce((n, p) => n + p.nodes.length, 0);
  const finished = phases.reduce((n, p) => n + p.finished, 0);
  const reused = Object.values(stream.nodes).filter((n) => n.status === "reused").length;
  const step = currentStep(phases, stream.nodes);
  const now = useNow(stream.status === "running" || stream.status === "queued");
  const elapsed = runElapsed(stream, now);
  const lost = stream.connection === "closed" && (stream.status === "running" || stream.status === "queued");

  const headline =
    stream.status === "queued"
      ? "Waiting for a free slot"
      : stream.status === "running"
        ? nowLabel(step)
        : stream.status === "completed"
          ? `Analysis complete (${total} steps)${elapsed ? ` · ${elapsed}` : ""}`
          : `The run failed${elapsed ? ` after ${elapsed}` : ""}`;
  const progress = stream.status === "running" ? `${finished}/${total} steps${elapsed ? ` · ${elapsed}` : ""}` : undefined;

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
      <div className="space-y-4">
        {run.parent_run_id && (
          <p className="rounded-md bg-brand/10 p-2 text-xs text-royal">
            Re-run of <Link className="underline" to={`/underwriting/runs/${run.parent_run_id}`}>the previous version</Link>{" "}
            after a correction{stream.status !== "queued" ? `: ${reused} steps reused, the rest recompute` : ""}.
          </p>
        )}
        <WorkTrace status={stream.status} text={headline} progress={progress} stubData={stream.stubData}>
          <UsageLine stream={stream} />
          <ol className="space-y-1.5">
            {phases.map((phase) => (
              <PhaseBlock key={phase.id} phase={phase} live={stream.nodes} />
            ))}
          </ol>
        </WorkTrace>
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
        {decision && summary && <SummaryBlock summary={summary} report={report} onOpenClaim={onOpenClaim} />}
        {decision && <VerdictCard decision={decision} report={report} onOpenReport={onOpenReport} />}
        {run.status === "failed" && !stream.error && run.error && (
          <ErrorBox error={new Error(run.error)} title="The run failed" />
        )}
      </div>
    </div>
  );
}
