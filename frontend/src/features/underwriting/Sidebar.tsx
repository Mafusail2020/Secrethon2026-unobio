import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDeleteRun, useHealth, useRuns } from "../../api/hooks";
import type { Decision, RunSummary } from "../../api/types";
import { PlusIcon, TrashIcon } from "../../components/ui/icons";
import { DECISION_LABEL } from "../../lib/format";
import { relativeTime } from "../../lib/relativeTime";
import { groupRuns, type RunGroup } from "./history";

const DOT: Record<Decision, string> = {
  invest: "bg-emerald-500",
  conditional: "bg-amber-500",
  do_not_invest: "bg-red-500",
};

function StatusDot({ run }: { run: RunSummary }) {
  if (run.status === "failed") return <span title="Failed" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500 ring-2 ring-red-200" />;
  if (run.decision) return <span title={DECISION_LABEL[run.decision]} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[run.decision]}`} />;
  return <span title="Running" className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />;
}

const working = (group: RunGroup) => group.runs.some((r) => r.status === "queued" || r.status === "running");

/** Asks before an underwriting goes: the report, its chat and its deck go with it, and demo runs are easy to hit by mistake. */
function ConfirmDelete({ group, pending, error, onConfirm, onCancel }: { group: RunGroup; pending: boolean; error: string | undefined; onConfirm: () => void; onCancel: () => void }) {
  const versions = group.runs.length - 1;
  return (
    <div
      role="group"
      aria-label="Confirm deletion"
      onKeyDown={(e) => e.key === "Escape" && !pending && onCancel()}
      className="uw-rise mx-1 mb-1 mt-0.5 rounded-lg border border-red-200 bg-white/85 px-3 py-2 text-xs"
    >
      <p className="font-medium text-ink">Delete this underwriting{versions > 0 ? ` and its ${versions} corrected version${versions === 1 ? "" : "s"}` : ""}?</p>
      <p className="mt-0.5 text-muted">The report, chat and deck go with it. This cannot be undone.</p>
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" autoFocus onClick={onCancel} disabled={pending} className="rounded-md border border-line bg-surface px-2.5 py-1 font-medium hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={pending} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60">
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

/** Past underwritings, newest first; a run and its corrected versions are one entry with v1, v2 … links. */
export function Sidebar({ currentId, onNavigate }: { currentId: string | undefined; onNavigate?: () => void }) {
  const runs = useRuns();
  const health = useHealth();
  const groups = useMemo(() => groupRuns(runs.data ?? []), [runs.data]);
  const [asking, setAsking] = useState<string | undefined>();
  const remove = useDeleteRun();
  const navigate = useNavigate();
  const ask = (rootId: string | undefined) => {
    remove.reset();
    setAsking(rootId);
  };
  const confirm = (group: RunGroup) =>
    remove.mutate(group.rootId, {
      onSuccess: () => {
        setAsking(undefined);
        // the page was showing what is gone
        if (group.runs.some((r) => r.id === currentId)) {
          navigate("/underwriting");
          onNavigate?.();
        }
      },
    });

  return (
    <nav aria-label="Underwritings" className="relative flex h-full min-h-0 flex-col">
      <div className="p-3">
        <Link
          to="/underwriting"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-royal text-white">
            <PlusIcon width={16} height={16} strokeWidth={2.4} />
          </span>
          New underwriting
        </Link>
      </div>

      <h2 className="px-5 pb-1 pt-2 text-xs font-medium text-muted">Recents</h2>
      <div className="uw-scroll-quiet min-h-0 flex-1 overflow-auto px-3 pb-3">
        {runs.isPending && (
          <div className="space-y-2 px-1" aria-busy="true" aria-label="Loading earlier underwritings">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
            ))}
          </div>
        )}
        {runs.error && <p className="px-2 text-xs text-red-700">Could not load the run history.</p>}
        {runs.data && groups.length === 0 && <p className="px-2 text-xs text-muted">Nothing yet. Your underwritings appear here.</p>}
        <ul className="space-y-0.5">
          {groups.map((group, index) => {
            const program = group.runs[0]!.program;
            const inGroup = group.runs.some((r) => r.id === currentId);
            return (
              <li key={group.rootId} className="uw-rise" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
                <div className="relative">
                  <Link
                    to={`/underwriting/runs/${group.latest.id}`}
                    onClick={onNavigate}
                    aria-current={inGroup ? "page" : undefined}
                    className="uw-history-row flex items-start gap-2.5 rounded-lg py-2 pl-2.5 pr-11 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <StatusDot run={group.latest} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{program.indication}</span>
                      <span className="block truncate text-xs text-muted">
                        {program.mechanism} · {relativeTime(group.latest.created_at)}
                      </span>
                    </span>
                  </Link>
                  {asking !== group.rootId && !working(group) && (
                    <div className="uw-delete-zone group/del absolute inset-y-0 right-0 flex w-11 items-center justify-center">
                      <button
                        type="button"
                        onClick={() => ask(group.rootId)}
                        aria-label={`Delete ${program.indication}, ${program.mechanism}`}
                        title="Delete"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-200 hover:bg-white/80 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 group-hover/del:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-70"
                      >
                        <TrashIcon width={16} height={16} />
                      </button>
                    </div>
                  )}
                </div>
                {asking === group.rootId && (
                  <ConfirmDelete
                    group={group}
                    pending={remove.isPending}
                    error={remove.error ? (remove.error.message || "Could not delete it.") : undefined}
                    onConfirm={() => confirm(group)}
                    onCancel={() => ask(undefined)}
                  />
                )}
                {group.runs.length > 1 && (
                  <ul className="mb-1 flex flex-wrap gap-1 pl-7" aria-label="Versions">
                    {group.runs.map((r, i) => (
                      <li key={r.id}>
                        <Link
                          to={`/underwriting/runs/${r.id}`}
                          onClick={onNavigate}
                          aria-current={r.id === currentId ? "page" : undefined}
                          className={`rounded-full border px-2 py-0.5 text-xs ${r.id === currentId ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:border-brand"}`}
                        >
                          v{i + 1}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line px-5 py-3 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${health.isError ? "bg-red-500" : health.data ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
          {health.isError ? "Backend not reachable" : health.data ? (health.data.llm_mode === "mock" ? "Mock model, no spend" : "Live model") : "Connecting…"}
        </span>
      </div>
    </nav>
  );
}
