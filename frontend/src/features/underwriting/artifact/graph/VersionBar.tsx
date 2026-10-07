import { useNavigate } from "react-router-dom";
import { useDiff, useRuns } from "../../../../api/hooks";
import type { RunSummary } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE, pct } from "../../../../lib/format";
import { familyOf } from "../../graphUtils";

export function VersionBar({ run, completed }: { run: RunSummary; completed: boolean }) {
  const navigate = useNavigate();
  const runs = useRuns();
  const diff = useDiff(run.parent_run_id, run.id, completed);
  const family = familyOf(runs.data ?? [run], run.id);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-3 py-2 text-sm">
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
      {diff.data && (
        <span className="flex flex-wrap items-center gap-2" data-testid="diff-badge">
          {diff.data.decision_before && diff.data.decision_after && (
            <>
              <Badge className={DECISION_STYLE[diff.data.decision_before]}>{DECISION_LABEL[diff.data.decision_before]}</Badge>
              <span>→</span>
              <Badge className={DECISION_STYLE[diff.data.decision_after]}>{DECISION_LABEL[diff.data.decision_after]}</Badge>
              {diff.data.decision_before === diff.data.decision_after && <span className="text-muted">decision unchanged</span>}
            </>
          )}
          {diff.data.pos_before && diff.data.pos_after && (
            <span className="text-muted">
              PoS {pct(diff.data.pos_before.base)} → {pct(diff.data.pos_after.base)}
            </span>
          )}
          <span className="text-muted">{diff.data.recomputed_nodes.length} nodes recomputed</span>
          {diff.data.changed_sections.length > 0 && (
            <span className="text-muted">{diff.data.changed_sections.length} sections changed</span>
          )}
        </span>
      )}
    </div>
  );
}
