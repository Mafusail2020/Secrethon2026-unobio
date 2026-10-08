import type { UnderwritingReport } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE, months, pct, usd } from "../../../../../lib/format";
import { useReportContext } from "../reportContext";
import { STANDING_LABEL, type QuestionId, type ReportTree } from "../reportTree";
import { BalanceBar } from "./BalanceBar";
import { SideBox, type Side } from "./SideBox";
import { STANDING_EDGE, STANDING_STYLE } from "./treeStyles";

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

function Reasons({ side, title, items }: { side: Side; title: string; items: ReportTree["reasons"]["positive"] }) {
  const { jumpToClaim } = useReportContext();
  return (
    <SideBox side={side} title={title}>
      {items.length === 0 ? (
        <p className="text-sm italic text-muted">None the verdict leaned on.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((rc) => {
            const claim = rc.claim_ids[0];
            return (
              <li key={rc.code} className="text-sm">
                {claim ? (
                  // the reason is its own link: clicking it opens the claim behind it, with its evidence
                  <button
                    type="button"
                    onClick={() => jumpToClaim(claim)}
                    title="Show the claim behind this"
                    className="-mx-1.5 block w-[calc(100%+0.75rem)] cursor-pointer rounded-sm px-1.5 py-1 text-left decoration-dotted underline-offset-4 hover:bg-white/70 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {rc.text}
                  </button>
                ) : (
                  rc.text
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SideBox>
  );
}

/** The four questions on one line: where each stands and how its claims split, with a way into each. */
function Strip({ tree, scale, onJump }: { tree: ReportTree; scale: number; onJump: (id: QuestionId) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-2 @3xl:grid-cols-4" aria-label="The four questions at a glance">
      {tree.questions.map((q) => (
        <li key={q.id}>
          <button
            type="button"
            onClick={() => onJump(q.id)}
            className={`block h-full w-full rounded-sm border border-l-4 border-line bg-canvas/60 px-3 py-2 text-left hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${STANDING_EDGE[q.standing]}`}
          >
            <span className="block text-sm font-semibold">{q.short}</span>
            <span className={`mt-0.5 inline-block rounded-full border px-1.5 text-[0.65rem] font-medium ${STANDING_STYLE[q.standing]}`}>{STANDING_LABEL[q.standing]}</span>
            <span className="mt-1.5 block">
              <BalanceBar pro={q.balance.pro} con={q.balance.con} scale={scale} label={`${q.pros.length} for, ${q.cons.length} against`} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The call, at a glance: the decision, the chance, what is at stake, and the few reasons that carried it. */
export function RootSummary({ report, tree, scale, onJump }: { report: UnderwritingReport; tree: ReportTree; scale: number; onJump: (id: QuestionId) => void }) {
  const { verdict, valuation } = report;
  const drag = tree.biggestDrag;
  return (
    <section id="summary" aria-label="The call" className="report-anchor rounded-sm border border-line bg-surface p-5 shadow-sm">
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

      <h2 className="mt-5 text-2xl font-semibold tracking-tight">
        {report.program.mechanism} in {report.program.indication}
      </h2>
      <p className="mt-1 text-[0.95rem] leading-relaxed">{verdict.rationale}</p>

      <div className="mt-4 grid gap-3 @xl:grid-cols-2">
        <Reasons side="for" title="What carries it" items={tree.reasons.positive} />
        <Reasons side="against" title="What holds it back" items={tree.reasons.negative} />
      </div>

      <div className="mt-4">
        <Strip tree={tree} scale={scale / 3} onJump={onJump} />
      </div>

      {drag && drag.impact && (
        <p className="mt-4 rounded-sm bg-canvas px-3 py-2 text-sm">
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
    </section>
  );
}
