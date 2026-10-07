import { useState } from "react";
import { Link } from "react-router-dom";
import { useGraph, useRunDetail } from "../../api/hooks";
import type { Decision } from "../../api/types";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Spinner } from "../../components/ui/Spinner";
import { ArtifactPanel, type TabId } from "./artifact/ArtifactPanel";
import type { FocusClaim } from "./artifact/report/reportContext";
import { Composer } from "./chat/Composer";
import { ExampleCards } from "./chat/ExampleCards";
import { FollowUp } from "./chat/FollowUp";
import { History } from "./chat/History";
import { RunThread } from "./chat/RunThread";
import { useRunStream } from "./useRunStream";

interface Prefill {
  indication: string;
  mechanism: string;
  nonce: number;
}

export function RunWorkspace({ runId }: { runId: string | undefined }) {
  const stream = useRunStream(runId);
  const graph = useGraph();
  const detail = useRunDetail(runId);
  const [tab, setTab] = useState<TabId | null>(null);
  const [prefill, setPrefill] = useState<Prefill | undefined>();
  const [focusClaim, setFocusClaim] = useState<FocusClaim | undefined>();

  const run = detail.data?.summary;
  const report = detail.data?.report ?? undefined;
  const completed = stream.status === "completed" && run?.status === "completed";
  const decision: Decision | undefined = run?.decision ?? (stream.decision as Decision | undefined);

  const sourceCounts = Object.fromEntries((detail.data?.nodes ?? []).map((n) => [n.node_id, n.source_ids.length]));

  const openClaim = (id: string) => {
    setTab("report");
    setFocusClaim({ id, nonce: Date.now() });
  };

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col bg-white">
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h1 className="text-base font-semibold">Underwriting</h1>
          {runId && (
            <Link to="/underwriting" className="text-sm font-medium text-brand hover:underline">
              New underwriting
            </Link>
          )}
        </header>
        <History currentId={runId} />
        <div className="min-h-0 flex-1 overflow-auto">
          {!runId && (
            <div className="space-y-4 p-3">
              <p className="text-sm text-muted">
                Tell me about a drug program. I research public evidence and tell you whether funding it to the next
                milestone is worth it, with every claim traceable to its sources.
              </p>
              <ExampleCards onPick={(e) => setPrefill({ indication: e.indication, mechanism: e.mechanism, nonce: Date.now() })} />
              <Composer key={prefill?.nonce ?? 0} initial={prefill} />
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
            <RunThread
              run={run}
              spec={graph.data}
              stream={stream}
              decision={decision}
              report={report}
              onOpenReport={() => setTab("report")}
            />
          )}
        </div>
        {runId && completed && report && <FollowUp runId={runId} report={report} onOpenClaim={openClaim} />}
      </aside>
      <ArtifactPanel
        tab={tab}
        onTab={setTab}
        run={run}
        graph={graph.data}
        stream={stream}
        report={report}
        canCorrect={completed}
        focusClaim={focusClaim}
        sourceCounts={sourceCounts}
        onOpenClaim={openClaim}
      />
    </div>
  );
}
