import type { Valuation } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { months, usd } from "../../../../../lib/format";
import { RangeBar } from "./RangeBar";

export function ValuationPanel({ valuation }: { valuation: Valuation }) {
  return (
    <section className="rounded-lg border border-line bg-white p-3" aria-labelledby="val-h">
      <h3 id="val-h" className="text-sm font-semibold">
        Funding to the next milestone
      </h3>
      <p className="text-sm">
        <span className="text-muted">Next milestone:</span> {valuation.next_milestone}
      </p>
      <div className="mt-2 space-y-3">
        <RangeBar range={valuation.capital_to_milestone} format={usd} label="Capital needed" min={0} />
        <RangeBar range={valuation.time_to_milestone_months} format={(v) => months({ ...valuation.time_to_milestone_months, base: v, low: v, high: v }).split(" (")[0]!} label="Time to milestone" min={0} />
        <RangeBar range={valuation.rnpv} format={usd} label="Risk-adjusted value (rNPV)" />
      </div>
      {valuation.value_inflection_points.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-muted">Value inflection points</h4>
          <ul className="list-disc pl-4 text-sm">
            {valuation.value_inflection_points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {valuation.assumptions.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-muted">Assumptions</h4>
          <ul className="space-y-1 text-xs">
            {valuation.assumptions.map((a) => (
              <li key={a.name} className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{a.name}</span>
                <span>
                  {a.value.base} ({a.value.low} to {a.value.high}) {a.value.unit}
                </span>
                {a.basis === "sourced" ? <Badge className="border-emerald-300 text-emerald-800">sourced</Badge> : <Badge className="border-slate-300 text-slate-600">assumption</Badge>}
                {a.citation && <span className="text-muted">{a.citation}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
