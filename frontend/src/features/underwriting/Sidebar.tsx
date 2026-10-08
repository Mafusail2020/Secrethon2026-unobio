import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useHealth, useRuns } from "../../api/hooks";
import type { Decision, RunSummary } from "../../api/types";
import { PlusIcon } from "../../components/ui/icons";
import { DECISION_LABEL } from "../../lib/format";
import { relativeTime } from "../../lib/relativeTime";
import { groupRuns } from "./history";

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

/** Past underwritings, newest first; a run and its corrected versions are one entry with v1, v2 … links. */
export function Sidebar({ currentId, onNavigate }: { currentId: string | undefined; onNavigate?: () => void }) {
  const runs = useRuns();
  const health = useHealth();
  const groups = useMemo(() => groupRuns(runs.data ?? []), [runs.data]);

  return (
    <nav aria-label="Underwritings" className="flex h-full min-h-0 flex-col">
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
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
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
                <Link
                  to={`/underwriting/runs/${group.latest.id}`}
                  onClick={onNavigate}
                  aria-current={inGroup ? "page" : undefined}
                  className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-slate-100 aria-[current=page]:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${inGroup ? "uw-flash" : ""}`}
                >
                  <StatusDot run={group.latest} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{program.indication}</span>
                    <span className="block truncate text-xs text-muted">
                      {program.mechanism} · {relativeTime(group.latest.created_at)}
                    </span>
                  </span>
                </Link>
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
