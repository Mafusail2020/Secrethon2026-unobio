import type { Decision, UnderwritingReport } from "../../../api/types";
import { DECISION_LABEL, pct } from "../../../lib/format";
import { PosStrip } from "./PosStrip";

const RULE: Record<Decision, string> = {
  invest: "border-emerald-600",
  conditional: "border-amber-500",
  do_not_invest: "border-red-600",
};
const WORD: Record<Decision, string> = {
  invest: "text-emerald-800",
  conditional: "text-amber-800",
  do_not_invest: "text-red-800",
};
const SERIF = { fontFamily: "var(--font-serif)" } as const;

/** The call, first: the decision, the probability of success and how sure the report is. */
export function VerdictSlip({
  decision,
  report,
  onOpenReport,
}: {
  decision: Decision;
  report: UnderwritingReport | undefined;
  onOpenReport: () => void;
}) {
  return (
    <section aria-label="Underwriting call" className={`rounded-lg border border-l-4 border-line bg-surface px-4 py-3 ${RULE[decision]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="label-mono text-muted">Underwriting call</p>
        {report && <p className="label-mono text-muted">{report.verdict.confidence} confidence</p>}
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <p className={`text-[2rem] leading-none ${WORD[decision]}`} style={SERIF}>
          {DECISION_LABEL[decision]}
        </p>
        {report && (
          <p className="flex items-baseline gap-2 text-muted">
            <span className="text-[2rem] leading-none text-ink" style={SERIF}>
              {pct(report.pos.base)}
            </span>
            <span className="text-sm">chance of success</span>
          </p>
        )}
      </div>
      {report && (
        <div className="mt-3">
          <PosStrip pos={report.pos} prior={report.twin_stats?.prior_pos} />
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onOpenReport}
          className="rounded-full border border-line px-3 py-1 text-sm font-medium text-brand hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Open report
        </button>
      </div>
    </section>
  );
}
