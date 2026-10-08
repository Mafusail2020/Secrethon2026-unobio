import { useNavigate } from "react-router-dom";
import { useDiff, useRuns } from "../../../../api/hooks";
import type { RunSummary } from "../../../../api/types";
import { DECISION_LABEL } from "../../../../lib/format";
import { familyOf } from "../../graphUtils";
import { buildDiffView } from "../report/diffView";
import { DiffSummaryCompact } from "../report/DiffSummary";

export function VersionBar({ run, completed }: { run: RunSummary; completed: boolean }) {
  const navigate = useNavigate();
  const runs = useRuns();
  const diff = useDiff(run.parent_run_id, run.id, completed);
  const family = familyOf(runs.data ?? [run], run.id);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-3 py-2 text-sm">
      <label className="flex items-center gap-2">
        Version
        <select
          className="rounded border border-line px-1 py-0.5"
          value={run.id}
          onChange={(e) => navigate(`/underwriting/runs/${e.target.value}`)}
        >
          {family.map((r, i) => (
            <option key={r.id} value={r.id}>
              v{i + 1}
              {r.parent_run_id ? " (correction)" : " (original)"}
              {r.decision ? ` · ${DECISION_LABEL[r.decision]}` : ""}
            </option>
          ))}
        </select>
      </label>
      {diff.data && <DiffSummaryCompact view={buildDiffView(diff.data, undefined, undefined)} />}
    </div>
  );
}
