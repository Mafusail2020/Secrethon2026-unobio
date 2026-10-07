import { useState } from "react";
import type { GraphSpec, NodeSpec, RunSummary, UnderwritingReport } from "../../../api/types";
import { Spinner } from "../../../components/ui/Spinner";
import { Tabs } from "../../../components/ui/Tabs";
import type { RunStream } from "../reduceEvents";
import { GraphView } from "./graph/GraphView";
import { NodeDrawer } from "./graph/NodeDrawer";
import { VersionBar } from "./graph/VersionBar";
import { LogsTimeline } from "./logs/LogsTimeline";
import { ReportView } from "./report/ReportView";
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

function GraphTab({
  run,
  graph,
  stream,
  report,
  canCorrect,
}: {
  run: RunSummary | undefined;
  graph: GraphSpec;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
}) {
  const [selected, setSelected] = useState<string | undefined>();
  const node: NodeSpec | undefined = graph.nodes.find((n) => n.id === selected);
  return (
    <div className="flex h-full flex-col">
      {run && <VersionBar run={run} completed={canCorrect} />}
      <div className="relative min-h-0 flex-1">
        <GraphView spec={graph} stream={stream} selected={selected} onSelect={setSelected} />
        {node && (
          <NodeDrawer
            key={node.id}
            runId={run?.id}
            node={node}
            graph={graph}
            stream={stream}
            report={report}
            canCorrect={canCorrect}
            onClose={() => setSelected(undefined)}
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
}: {
  tab: TabId | null;
  onTab: (tab: TabId) => void;
  run: RunSummary | undefined;
  graph: GraphSpec | undefined;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
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
        {active === "report" && (report ? <ReportView report={report} /> : waiting)}
        {active === "graph" &&
          (graph ? (
            <GraphTab run={run} graph={graph} stream={stream} report={report} canCorrect={canCorrect} />
          ) : (
            <Empty>
              <Spinner />
            </Empty>
          ))}
        {active === "sources" && (report ? <SourcesTable report={report} /> : waiting)}
        {active === "logs" && (run ? <LogsTimeline events={stream.events} runId={run.id} /> : waiting)}
      </div>
    </section>
  );
}
