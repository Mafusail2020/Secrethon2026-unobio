import { useState } from "react";
import type { GraphSpec, NodeSpec, RunSummary, UnderwritingReport } from "../../../api/types";
import { Spinner } from "../../../components/ui/Spinner";
import { Tabs } from "../../../components/ui/Tabs";
import { affectedSet, runnableNodes } from "../graphUtils";
import type { RunStream } from "../reduceEvents";
import { GraphView } from "./graph/GraphView";
import { NodeDrawer, type DrawerTab } from "./graph/NodeDrawer";
import { VersionBar } from "./graph/VersionBar";
import { LogsTimeline } from "./logs/LogsTimeline";
import { ReportView } from "./report/ReportView";
import type { FocusClaim } from "./report/reportContext";
import { SourcesTable } from "./sources/SourcesTable";

export type TabId = "report" | "graph" | "sources" | "logs";


const TABS: { id: TabId; label: string }[] = [
  { id: "report", label: "Report" },
  { id: "graph", label: "Graph" },
  { id: "sources", label: "Sources" },
  { id: "logs", label: "Logs" },
];

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
    <p role="status" className="border-b border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-900">
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
        <p role="status" className="border-b border-violet-200 bg-violet-50 px-3 py-1 text-xs text-violet-900">
          Correcting {node.label} recomputes {highlight.size} of {total} steps (outlined); the rest are reused.
        </p>
      )}
      <div className="relative min-h-0 flex-1">
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
              setSelected(undefined);
              setDrawerTab("overview");
            }}
          />
        )}
      </div>
    </div>
  );
}

export function ArtifactPanel({
  tab,
  onTab,
  run,
  graph,
  stream,
  report,
  canCorrect,
  focusClaim,
  sourceCounts,
  onOpenClaim,
}: {
  tab: TabId | null;
  onTab: (tab: TabId) => void;
  run: RunSummary | undefined;
  graph: GraphSpec | undefined;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
  focusClaim?: FocusClaim;
  sourceCounts: Record<string, number>;
  onOpenClaim: (claimId: string) => void;
}) {
  const active: TabId = tab ?? (report ? "report" : "graph");
  const waiting = run ? (
    <Empty>
      <span className="flex items-center gap-2">
        <Spinner /> The report appears here when the analysis finishes. Watch the Graph tab meanwhile.
      </span>
    </Empty>
  ) : (
    <Empty>Describe a drug program on the left to start an underwriting run.</Empty>
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-l border-line bg-canvas">
      <Tabs tabs={TABS} active={active} onChange={onTab} />
      <div className="min-h-0 flex-1 overflow-auto">
        {active === "report" &&
          (report && run ? (
            <ReportView report={report} runId={run.id} graph={graph} canCorrect={canCorrect} focusClaim={focusClaim} />
          ) : (
            waiting
          ))}
        {active === "graph" &&
          (graph ? (
            <GraphTab run={run} graph={graph} stream={stream} report={report} canCorrect={canCorrect} sourceCounts={sourceCounts} />
          ) : (
            <Empty>
              <Spinner />
            </Empty>
          ))}
        {active === "sources" && (report ? <SourcesTable report={report} onOpenClaim={onOpenClaim} /> : waiting)}
        {active === "logs" && (run ? <LogsTimeline events={stream.events} runId={run.id} /> : waiting)}
      </div>
    </section>
  );
}
