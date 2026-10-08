import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type UIEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useGraph, useRunDetail, useSummary } from "../../api/hooks";
import type { Decision } from "../../api/types";
import { GlyphField } from "../../components/glyph-field/GlyphField";
import { PRESETS } from "../../components/glyph-field/presets";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { readPref, writePref } from "../../lib/storage";
import type { TabId } from "./artifact/ViewContent";
import type { FocusClaim } from "./artifact/report/reportContext";
import { FollowUpInput, FollowUpMessages } from "./chat/FollowUp";
import { RunThread } from "./chat/RunThread";
import { useFollowUp } from "./chat/useFollowUp";
import { Welcome } from "./chat/Welcome";
import { ConnectionBanner } from "./ConnectionBanner";
import { SplitHandle } from "./dock/SplitHandle";
import { useDock } from "./dock/useDock";
import { ViewDataContext } from "./dock/viewData";
import { ViewsDock } from "./dock/ViewsDock";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useRunStream } from "./useRunStream";

const PREF_SIDEBAR = "uw.sidebar";
const PREF_DOCK = "uw.dockPercent";
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
  const dock = useDock({ persist: !!runId, initial: panelFromState(location.state) });
  const [dockPercent, setDockPercent] = useState(() => Number(readPref(PREF_DOCK)) || 58);
  const row = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => isWide() && readPref(PREF_SIDEBAR) !== "closed");
  const [focusClaim, setFocusClaim] = useState<FocusClaim | undefined>();

  const run = detail.data?.summary;
  const report = detail.data?.report ?? undefined;
  const completed = stream.status === "completed" && run?.status === "completed";
  const decision: Decision | undefined = run?.decision ?? (stream.decision as Decision | undefined);
  const follow = useFollowUp(runId ?? "", !!runId && completed);
  const readout = useSummary(runId ?? "", !!runId && completed);

  const sourceCounts = Object.fromEntries((detail.data?.nodes ?? []).map((n) => [n.node_id, n.source_ids.length]));

  const openClaim = (id: string) => {
    dock.show("report");
    setFocusClaim({ id, nonce: Date.now() });
  };
  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      writePref(PREF_SIDEBAR, open ? "closed" : "open");
      return !open;
    });

  // the row's width, to give the dock a fixed pixel width that does not change while it opens
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setRowWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // follow the thread while it grows, unless the reader scrolled up
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  };
  const grew = `${stream.events.length}:${follow.messages.length}:${follow.ask.isPending}:${detail.isPending}:${readout.isLoading}:${!!readout.data}`;
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [grew]);

  const hasViews = dock.open.length > 0;
  const dockPx = Math.round((rowWidth * dockPercent) / 100);
  const title = run ? `${run.program.indication} · ${run.program.mechanism}` : "New underwriting";

  return (
    <div data-uw data-print-flow className="relative flex h-full min-h-0">
      <button
        type="button"
        aria-label="Close the history"
        onClick={toggleSidebar}
        tabIndex={sidebarOpen ? 0 : -1}
        aria-hidden={!sidebarOpen}
        className={`absolute inset-0 z-20 bg-navy/30 transition-opacity duration-200 md:hidden ${sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        data-print-hide
        aria-label="History"
        inert={!sidebarOpen}
        className={`absolute inset-y-0 left-0 z-30 w-72 max-w-[85vw] shrink-0 overflow-hidden bg-canvas transition-[translate,width,box-shadow] duration-200 ease-out md:static md:z-auto md:shadow-none ${
          sidebarOpen ? "translate-x-0 shadow-xl md:w-72" : "-translate-x-full shadow-none md:w-0 md:translate-x-0"
        }`}
      >
        <div className="relative h-full w-72 max-w-[85vw]">
          <GlyphField {...PRESETS.mist} className="absolute inset-0 h-full w-full" />
          <Sidebar currentId={runId} onNavigate={() => !isWide() && setSidebarOpen(false)} />
        </div>
      </aside>

      <div data-print-flow className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <ConnectionBanner />
        <div data-print-hide>
          <TopBar
            title={title}
            decision={decision}
            hasRun={!!runId}
            open={dock.open}
            onTogglePanel={dock.toggle}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        </div>

        <div ref={row} data-print-flow className="relative flex min-h-0 flex-1">
          <section data-print-hide aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                      summary={
                        completed
                          ? { message: readout.data, pending: readout.isLoading, failed: readout.isError, retry: () => void readout.refetch() }
                          : undefined
                      }
                      onOpenReport={() => dock.show("report")}
                      onOpenClaim={openClaim}
                      onReconnect={() => setAttempt((a) => a + 1)}
                    />
                  )}
                  {run && completed && <FollowUpMessages follow={follow} report={report} onOpenClaim={openClaim} />}
                </div>
              )}
            </div>
            {run && <FollowUpInput follow={follow} ready={completed} />}
          </section>

          <div
            data-print-flow
            aria-hidden={!hasViews}
            inert={!hasViews}
            style={{ "--dock": `${dockPercent}%`, "--dock-px": `${dockPx}px` } as CSSProperties}
            className={`overflow-hidden bg-canvas max-xl:absolute max-xl:inset-0 max-xl:z-10 max-xl:transition-[translate,opacity] max-xl:duration-300 max-xl:ease-out xl:relative xl:flex-none ${
              dragging ? "" : "xl:transition-[flex-basis] xl:duration-300 xl:ease-[cubic-bezier(0.4,0,0.2,1)]"
            } ${hasViews ? "max-xl:translate-x-0 xl:basis-(--dock)" : "max-xl:pointer-events-none max-xl:translate-x-full max-xl:opacity-0 xl:basis-0"}`}
          >
            {hasViews && (
              <SplitHandle
                value={dockPercent}
                onChange={setDockPercent}
                onCommit={(v) => writePref(PREF_DOCK, String(Math.round(v)))}
                onDragging={setDragging}
                row={row}
              />
            )}
            {/* its width is fixed while the area opens, so the views are laid out once and only revealed */}
            <div data-print-flow className="h-full w-full xl:w-(--dock-px)">
            <ViewDataContext.Provider
              value={{
                run,
                graph: graph.data,
                graphError: graph.error,
                onRetryGraph: () => void graph.refetch(),
                stream,
                report,
                canCorrect: completed,
                focusClaim,
                sourceCounts,
                onOpenClaim: openClaim,
              }}
            >
              <ViewsDock onReady={dock.onReady} />
            </ViewDataContext.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
