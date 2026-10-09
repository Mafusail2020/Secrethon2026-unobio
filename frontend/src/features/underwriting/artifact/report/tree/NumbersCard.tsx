import type { UnderwritingReport } from "../../../../../api/types";
import { CauseChart } from "../charts/CauseChart";
import { EvidenceMix } from "../charts/EvidenceMix";
import { SourceMix } from "../charts/SourceMix";
import { LedgerWaterfall } from "../quant/LedgerWaterfall";
import { TwinPanel } from "../quant/TwinPanel";
import { ValuationPanel } from "../quant/ValuationPanel";
import { Chevron } from "./Chevron";
import { Collapse } from "./Collapse";

function Missing({ title, why }: { title: string; why: string }) {
  return (
    <section className="rounded-sm border border-dashed border-line bg-surface/60 p-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-xs text-muted">{why}</p>
    </section>
  );
}

/** The charts behind the call: how the probability was built, what the claims stand on, and what it costs. */
export function NumbersCard({ report, open, onToggle }: { report: UnderwritingReport; open: boolean; onToggle: () => void }) {
  const claims = Object.values(report.claims);
  return (
    <section id="numbers" aria-labelledby="numbers-title" className="report-anchor rounded-sm border border-l-[6px] border-line border-l-brand bg-surface shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="numbers-body"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-t-sm p-4 text-left hover:bg-canvas/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span>
          <span id="numbers-title" className="block text-xl font-semibold leading-snug tracking-tight">
            The numbers behind it
          </span>
          <span className="mt-1 block text-[0.95rem] text-muted">How the probability was built, what the claims rest on, similar programs, and what funding costs.</span>
        </span>
        <Chevron open={open} />
      </button>
      <Collapse open={open} id="numbers-body">
        <div className="space-y-4 px-4 pb-4">
          {report.ledger ? <LedgerWaterfall ledger={report.ledger} /> : <Missing title="Evidence ledger" why="No evidence ledger was produced, so the probability rests on the similar-programs prior alone." />}
          <div className="grid gap-4 @3xl:grid-cols-2">
            {report.ledger && <CauseChart ledger={report.ledger} />}
            <div className="space-y-4">
              <EvidenceMix claims={claims} />
              <SourceMix report={report} />
            </div>
          </div>
          <div className="grid gap-4 @3xl:grid-cols-2">
            {report.twin_stats ? <TwinPanel twin={report.twin_stats} report={report} /> : <Missing title="Similar programs" why="Historical twin statistics are not available for this run." />}
            {report.valuation ? <ValuationPanel valuation={report.valuation} /> : <Missing title="Funding to the next milestone" why="No valuation was produced for this run." />}
          </div>
        </div>
      </Collapse>
    </section>
  );
}
