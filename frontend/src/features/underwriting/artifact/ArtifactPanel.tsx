import { useState } from "react";
import type { GraphSpec, NodeSpec, RunSummary, UnderwritingReport } from "../../../api/types";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { Spinner } from "../../../components/ui/Spinner";
import { CloseIcon } from "../../../components/ui/icons";
import { affectedSet, runnableNodes } from "../graphUtils";
import type { RunStream } from "../reduceEvents";
import { GraphView } from "./graph/GraphView";
import { NodeDrawer, type DrawerTab } from "./graph/NodeDrawer";
import { VersionBar } from "./graph/VersionBar";
import { LogsTimeline } from "./logs/LogsTimeline";
import { ReportView } from "./report/ReportView";
import type { FocusClaim } from "./report/reportContext";
import { isSyntheticReport } from "./report/synthetic";
import { SourcesTable } from "./sources/SourcesTable";

export type TabId = "report" | "graph" | "sources" | "logs";

const TITLE: Record<TabId, string> = {
  report: "Report",
  graph: "Graph",
  sources: "Sources",
  logs: "Logs",
};

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">{children}</div>;
}

function RerunBanner({ run, stream, total }: { run: RunSummary; stream: RunStream; total: number }) {
  const planned = stream.events.find((e) => e.type === "run.started")?.data.reused;
  const reused = Math.max(Array.isArray(planned) ? planned.length : 0, Object.values(stream.nodes).filter((n) => n.status === "reused").length);
  const recompute = total - reused;
  if (!run.parent_run_id || stream.status === "queued") return null;
  const text =
    stream.status === "completed"
      ? `Re-run complete: ${reused} steps reused, ${recompute} recomputed.`
      : stream.status === "failed"
        ? "The re-run failed."
        : `Re-running: ${reused} steps reused, ${recompute} recomputing.`;
  return (
    <p role="status" className="border-b border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-royal">
      {text}
    </p>
  );
}

function GraphTab({
  run,
  graph,
  stream,
  report,
  canCorrect,
  sourceCounts,
}: {
  run: RunSummary | undefined;
  graph: GraphSpec;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
  sourceCounts: Record<string, number>;
}) {
  const [selected, setSelected] = useState<string | undefined>();
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const node: NodeSpec | undefined = graph.nodes.find((n) => n.id === selected);
  // while the correction form is open, show what it would recompute
  const highlight = node && drawerTab === "correct" ? affectedSet(graph, node.id) : undefined;
  const total = runnableNodes(graph).length;

  return (
    <div className="flex h-full flex-col">
      {run && <VersionBar run={run} completed={canCorrect} />}
      {run && <RerunBanner run={run} stream={stream} total={total} />}
      {highlight && node && (
        <p role="status" className="border-b border-brand/30 bg-brand/10 px-3 py-1 text-xs text-royal">
          Correcting {node.label} recomputes {highlight.size} of {total} steps (outlined); the rest are reused.
        </p>
      )}
      <div className="relative min-h-0 flex-1 max-md:min-h-[32rem]">
        <GraphView spec={graph} stream={stream} selected={selected} onSelect={setSelected} sourceCounts={sourceCounts} highlight={highlight} />
        {node && (
          <NodeDrawer
            key={node.id}
            run={run}
            node={node}
            graph={graph}
            stream={stream}
            report={report}
            canCorrect={canCorrect}
            tab={drawerTab}
            onTab={setDrawerTab}
            onClose={() => {
              const id = node.id;
              setSelected(undefined);
              setDrawerTab("overview");
              // hand focus back to the step that opened the drawer
              requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-id="${id}"] button`)?.focus());
            }}
          />
        )}
      </div>
    </div>
  );
}

export function ArtifactPanel({
  tab,
  onClose,
  run,
  graph,
  graphError,
  onRetryGraph,
  stream,
  report,
  canCorrect,
  focusClaim,
  sourceCounts,
  onOpenClaim,
}: {
  tab: TabId;
  onClose: () => void;
  run: RunSummary | undefined;
  graph: GraphSpec | undefined;
  graphError?: unknown;
  onRetryGraph?: () => void;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
  focusClaim?: FocusClaim;
  sourceCounts: Record<string, number>;
  onOpenClaim: (claimId: string) => void;
}) {
  const active = tab;
  const stubbed = stream.stubData || (!!report && isSyntheticReport(report));
  const failed = run?.status === "failed" || stream.status === "failed";
  const waiting = failed ? (
    <Empty>This run failed before it produced a report. The Graph view shows which step failed and why; the conversation can run it again.</Empty>
  ) : run ? (
    <Empty>
      <span className="flex items-center gap-2">
        <Spinner /> The report appears here when the analysis finishes. Open the Graph view to watch it run.
      </span>
    </Empty>
  ) : (
    <Empty>Start an underwriting to see its report, sources and logs here.</Empty>
  );

  return (
    <section id="artifact-panel" data-print-flow aria-label={TITLE[active]} className="flex h-full min-h-0 min-w-0 flex-col border-l border-line bg-canvas">
      <header data-print-hide className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
        <h2 className="text-sm font-medium">{TITLE[active]}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${TITLE[active]}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </header>
      {stubbed && active !== "report" && (
        <p role="note" className="border-b border-amber-300 bg-amber-50 px-4 py-1 text-xs text-amber-900">
          Synthetic data: parts of this run come from stub steps and contain placeholder content.
        </p>
      )}
      <div data-print-flow className="min-h-0 flex-1 overflow-auto">
        <ErrorBoundary resetKey={`${active}:${run?.id ?? ""}`}>
          {active === "report" &&
            (report && run ? (
              <ReportView report={report} runId={run.id} graph={graph} canCorrect={canCorrect} focusClaim={focusClaim} />
            ) : (
              waiting
            ))}
          {active === "graph" &&
            (graph ? (
              <GraphTab run={run} graph={graph} stream={stream} report={report} canCorrect={canCorrect} sourceCounts={sourceCounts} />
            ) : graphError ? (
              <div className="space-y-2 p-4">
                <ErrorBox error={graphError} title="Could not load the pipeline graph" />
                <button type="button" onClick={onRetryGraph} className="rounded-full border border-line bg-surface px-3 py-1 text-sm">
                  Try again
                </button>
              </div>
            ) : (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading the pipeline graph">
                <div className="mx-auto h-12 w-48 animate-pulse rounded bg-line/50" />
                <div className="mx-auto h-12 w-48 animate-pulse rounded bg-line/50" />
                <div className="grid grid-cols-3 gap-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded bg-line/50" />
                  ))}
                </div>
              </div>
            ))}
          {active === "sources" && (report ? <SourcesTable report={report} onOpenClaim={onOpenClaim} /> : waiting)}
          {active === "logs" && (run ? <LogsTimeline events={stream.events} runId={run.id} /> : waiting)}
        </ErrorBoundary>
      </div>
    </section>
  );
}
