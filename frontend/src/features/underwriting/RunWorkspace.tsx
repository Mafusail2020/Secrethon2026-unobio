import { useState } from "react";
import { Link } from "react-router-dom";
import { useGraph, useRunDetail } from "../../api/hooks";
import type { Decision } from "../../api/types";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Spinner } from "../../components/ui/Spinner";
import { ArtifactPanel, type TabId } from "./artifact/ArtifactPanel";
import { Composer } from "./chat/Composer";
import { RunThread } from "./chat/RunThread";
import { useRunStream } from "./useRunStream";

export function RunWorkspace({ runId }: { runId: string | undefined }) {
  const stream = useRunStream(runId);
  const graph = useGraph();
  const detail = useRunDetail(runId);
  const [tab, setTab] = useState<TabId | null>(null);

  const run = detail.data?.summary;
  const report = detail.data?.report ?? undefined;
  const completed = stream.status === "completed" && run?.status === "completed";
  const decision: Decision | undefined = run?.decision ?? (stream.decision as Decision | undefined);

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-auto bg-white">
        <h1 className="border-b border-line px-4 py-3 text-base font-semibold">Underwriting</h1>
        {!runId && (
          <div className="space-y-3 p-3">
            <p className="text-sm text-muted">
              Tell me about a drug program. I research public evidence and tell you whether funding it to the next
              milestone is worth it, with every claim traceable to its sources.
            </p>
            <Composer />
          </div>
        )}
        {runId && detail.isPending && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {runId && detail.error && (
          <div className="space-y-2 p-3">
            <ErrorBox error={detail.error} title="Could not load this run" />
            <Link to="/underwriting" className="text-sm text-brand hover:underline">
              Start a new underwriting
            </Link>
          </div>
        )}
        {run && graph.data && (
          <>
            <RunThread run={run} spec={graph.data} stream={stream} decision={decision} onOpenReport={() => setTab("report")} />
            <div className="mt-auto border-t border-line p-3">
              <Link to="/underwriting" className="text-sm font-medium text-brand hover:underline">
                + New underwriting
              </Link>
            </div>
          </>
        )}
      </aside>
      <ArtifactPanel
        tab={tab}
        onTab={setTab}
        run={run}
        graph={graph.data}
        stream={stream}
        report={report}
        canCorrect={completed}
      />
    </div>
  );
}
