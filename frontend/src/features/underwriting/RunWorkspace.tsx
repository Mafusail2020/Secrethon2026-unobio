import { useEffect, useRef, useState, type UIEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useGraph, useRunDetail } from "../../api/hooks";
import type { Decision } from "../../api/types";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { readPref, writePref } from "../../lib/storage";
import { ArtifactPanel, type TabId } from "./artifact/ArtifactPanel";
import type { FocusClaim } from "./artifact/report/reportContext";
import { FollowUpInput, FollowUpMessages } from "./chat/FollowUp";
import { RunThread } from "./chat/RunThread";
import { useFollowUp } from "./chat/useFollowUp";
import { Welcome } from "./chat/Welcome";
import { ConnectionBanner } from "./ConnectionBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useRunStream } from "./useRunStream";

const PREF_SIDEBAR = "uw.sidebar";
const isWide = () => typeof window !== "undefined" && window.innerWidth >= 768;
const VIEWS: readonly string[] = ["report", "graph", "sources", "logs"];

/** A page that remounts the workspace (a correction, a version switch) can say which view to keep open. */
function panelFromState(state: unknown): TabId | null {
  const panel = (state as { panel?: string } | null)?.panel;
  return panel && VIEWS.includes(panel) ? (panel as TabId) : null;
}

export function RunWorkspace({ runId }: { runId: string | undefined }) {
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const stream = useRunStream(runId, attempt);
  const graph = useGraph();
  const detail = useRunDetail(runId);
  const [panel, setPanel] = useState<TabId | null>(() => panelFromState(location.state));
  const [sidebarOpen, setSidebarOpen] = useState(() => isWide() && readPref(PREF_SIDEBAR) !== "closed");
  const [focusClaim, setFocusClaim] = useState<FocusClaim | undefined>();

  const run = detail.data?.summary;
  const report = detail.data?.report ?? undefined;
  const completed = stream.status === "completed" && run?.status === "completed";
  const decision: Decision | undefined = run?.decision ?? (stream.decision as Decision | undefined);
  const follow = useFollowUp(runId ?? "", !!runId && completed);

  const sourceCounts = Object.fromEntries((detail.data?.nodes ?? []).map((n) => [n.node_id, n.source_ids.length]));

  const openClaim = (id: string) => {
    setPanel("report");
    setFocusClaim({ id, nonce: Date.now() });
  };
  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      writePref(PREF_SIDEBAR, open ? "closed" : "open");
      return !open;
    });

  // follow the thread while it grows, unless the reader scrolled up
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  };
  const grew = `${stream.events.length}:${follow.messages.length}:${follow.ask.isPending}:${detail.isPending}`;
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [grew]);

  const title = run ? `${run.program.indication} · ${run.program.mechanism}` : "New underwriting";

  return (
    <div data-uw data-print-flow className="relative flex h-full min-h-0">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close the history"
          onClick={toggleSidebar}
          className="absolute inset-0 z-20 bg-navy/30 md:hidden"
        />
      )}
      <aside
        data-print-hide
        aria-label="History"
        className={`${sidebarOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-30 w-72 max-w-[85vw] shrink-0 flex-col border-r border-line bg-canvas shadow-xl md:static md:z-auto md:shadow-none`}
      >
        <Sidebar currentId={runId} onNavigate={() => !isWide() && setSidebarOpen(false)} />
      </aside>

      <div data-print-flow className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <ConnectionBanner />
        <div data-print-hide>
          <TopBar
            title={title}
            decision={decision}
            hasRun={!!runId}
            panel={panel}
            onTogglePanel={(id) => setPanel((p) => (p === id ? null : id))}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        </div>

        <div data-print-flow className="relative flex min-h-0 flex-1">
          <section data-print-hide aria-label="Conversation" className={`flex min-h-0 min-w-0 flex-1 flex-col ${panel ? "xl:max-w-[40%] xl:flex-none xl:basis-[40%]" : ""}`}>
            <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
              {!runId && <Welcome />}
              {runId && (
                <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
                  {detail.isPending && (
                    <div className="space-y-3" aria-busy="true" aria-label="Loading the run">
                      <div className="ml-auto h-16 w-2/3 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
                      ))}
                    </div>
                  )}
                  {detail.error && (
                    <div className="space-y-2">
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
                      onOpenReport={() => setPanel("report")}
                      onReconnect={() => setAttempt((a) => a + 1)}
                    />
                  )}
                  {run && completed && <FollowUpMessages follow={follow} report={report} onOpenClaim={openClaim} />}
                </div>
              )}
            </div>
            {run && <FollowUpInput follow={follow} ready={completed} />}
          </section>

          {panel && (
            <div data-print-flow className="absolute inset-0 z-10 xl:static xl:z-auto xl:basis-[60%]">
              <ArtifactPanel
                tab={panel}
                onClose={() => setPanel(null)}
                run={run}
                graph={graph.data}
                graphError={graph.error}
                onRetryGraph={() => void graph.refetch()}
                stream={stream}
                report={report}
                canCorrect={completed}
                focusClaim={focusClaim}
                sourceCounts={sourceCounts}
                onOpenClaim={openClaim}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
