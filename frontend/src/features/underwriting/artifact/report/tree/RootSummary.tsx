import type { UnderwritingReport } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE, months, pct, usd } from "../../../../../lib/format";
import { useReportContext } from "../reportContext";
import type { ReportTree } from "../reportTree";
import { BalanceBar } from "./BalanceBar";

function Ruler({ range }: { range: UnderwritingReport["pos"] }) {
  const top = Math.min(1, Math.max(range.high * 1.25, 0.2));
  const at = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="mt-2 w-56 max-w-full">
      <div role="img" aria-label={`Probability of success ${pct(range.base)}, range ${pct(range.low)} to ${pct(range.high)}`} className="relative h-1.5 rounded-full bg-slate-200">
        <span className="absolute inset-y-0 rounded-full bg-brand/35" style={{ left: at(range.low), width: `calc(${at(range.high)} - ${at(range.low)})` }} />
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand" style={{ left: at(range.base) }} />
      </div>
      <div className="mt-1 flex justify-between text-[0.65rem] text-muted">
        <span>0%</span>
        <span>
          range {pct(range.low)} to {pct(range.high)}
        </span>
      </div>
    </div>
  );
}

function Reasons({ title, tone, items }: { title: string; tone: string; items: ReportTree["reasons"]["positive"] }) {
  const { jumpToClaim } = useReportContext();
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">None the verdict leaned on.</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((rc) => (
            <li key={rc.code} className="text-sm">
              {rc.text}
              {rc.claim_ids.slice(0, 1).map((id) => (
                <button key={id} type="button" onClick={() => jumpToClaim(id)} className="ml-1.5 rounded-full border border-line px-1.5 text-xs text-brand hover:border-brand">
                  why
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The call, at a glance: the decision, the chance, what is at stake, and the few reasons that carried it. */
export function RootSummary({ report, tree, scale }: { report: UnderwritingReport; tree: ReportTree; scale: number }) {
  const { verdict, valuation } = report;
  const pro = tree.questions.reduce((sum, q) => sum + q.balance.pro, 0);
  const con = tree.questions.reduce((sum, q) => sum + q.balance.con, 0);
  const drag = tree.biggestDrag;
  return (
    <section id="summary" aria-label="The call" className="report-anchor rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div id="summary-call">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`px-3 py-0.5 text-sm ${DECISION_STYLE[verdict.decision]}`}>{DECISION_LABEL[verdict.decision]}</Badge>
            <span className="text-xs text-muted">{verdict.confidence} confidence</span>
          </div>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Probability of success</p>
          <p className="font-serif text-6xl leading-none tracking-tight text-ink">{pct(report.pos.base)}</p>
          <Ruler range={report.pos} />
        </div>
        {valuation && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Risk-adjusted value</dt>
            <dd className="text-right font-semibold tabular-nums">{usd(valuation.rnpv.base)}</dd>
            <dt className="text-muted">Capital to next milestone</dt>
            <dd className="text-right font-semibold tabular-nums">{usd(valuation.capital_to_milestone.base)}</dd>
            <dt className="text-muted">Time to it</dt>
            <dd className="text-right font-semibold tabular-nums">{months({ ...valuation.time_to_milestone_months, low: valuation.time_to_milestone_months.base, high: valuation.time_to_milestone_months.base }).split(" (")[0]}</dd>
          </dl>
        )}
      </div>

      <h2 className="mt-5 text-lg font-semibold">
        {report.program.mechanism} in {report.program.indication}
      </h2>
      <p className="mt-1 text-[0.95rem] leading-relaxed">{verdict.rationale}</p>

      <div className="mt-4 grid gap-4 @xl:grid-cols-2">
        <Reasons title="What carries it" tone="text-emerald-700" items={tree.reasons.positive} />
        <Reasons title="What holds it back" tone="text-red-700" items={tree.reasons.negative} />
      </div>

      {drag && drag.impact && (
        <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-sm">
          The biggest drag on the chance is <strong>{drag.title.toLowerCase()}</strong> ({drag.impact.pts.toFixed(1)} points).
        </p>
      )}

      {verdict.conditions.length > 0 && (
        <div className="mt-4 text-sm">
          <span className="font-medium">To proceed:</span>
          <ul className="list-disc pl-5">
            {verdict.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-1 flex justify-between text-[0.65rem] uppercase tracking-wide text-muted">
          <span>For the program</span>
          <span>Against it</span>
        </div>
        <BalanceBar pro={pro} con={con} scale={Math.max(pro, con, scale)} label={`All claims, weighted by confidence: ${pro} for, ${con} against`} />
      </div>
    </section>
  );
}
