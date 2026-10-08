import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useRuns } from "../../../api/hooks";
import { Badge } from "../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE } from "../../../lib/format";
import { relativeTime } from "../../../lib/relativeTime";
import { groupRuns } from "../history";

/** Earlier runs, grouped so a run and its correction versions read as v1, v2, … */
export function History({ currentId }: { currentId: string | undefined }) {
  const runs = useRuns();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupRuns(runs.data ?? []), [runs.data]);

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span>History{runs.data ? ` (${groups.length})` : ""}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="max-h-64 overflow-auto px-3 pb-3">
          {runs.isPending && (
            <div className="space-y-2" aria-busy="true">
              <div className="h-9 animate-pulse rounded bg-canvas" />
              <div className="h-9 animate-pulse rounded bg-canvas" />
            </div>
          )}
          {runs.error && <p className="text-xs text-red-700">Could not load the run history.</p>}
          {runs.data && groups.length === 0 && <p className="text-xs text-muted">No earlier runs yet.</p>}
          <ul className="space-y-1.5">
            {groups.map((group) => {
              const program = group.runs[0]!.program;
              const inGroup = group.runs.some((r) => r.id === currentId);
              return (
                <li key={group.rootId} className={`rounded-md border p-2 ${inGroup ? "border-brand" : "border-line"}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <Link to={`/underwriting/runs/${group.latest.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {program.indication} · {program.mechanism}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{relativeTime(group.latest.created_at)}</span>
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {group.runs.map((r, i) => (
                      <li key={r.id}>
                        <Link
                          to={`/underwriting/runs/${r.id}`}
                          aria-current={r.id === currentId ? "page" : undefined}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                            r.id === currentId ? "border-brand bg-brand/10" : "border-line hover:border-brand"
                          }`}
                        >
                          v{i + 1}
                          {r.status === "failed" && <span className="text-red-600">failed</span>}
                          {r.status !== "failed" && r.status !== "completed" && <span className="text-muted">{r.status}</span>}
                          {r.decision && <Badge className={`px-1.5 py-0 ${DECISION_STYLE[r.decision]}`}>{DECISION_LABEL[r.decision]}</Badge>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
