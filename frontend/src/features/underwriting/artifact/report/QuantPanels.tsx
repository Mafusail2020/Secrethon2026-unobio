import type { UnderwritingReport } from "../../../../api/types";
import { months, pct, pctRange, usdRange } from "../../../../lib/format";

const card = "rounded-lg border border-line bg-white p-3";

export function TwinPanel({ twin }: { twin: NonNullable<UnderwritingReport["twin_stats"]> }) {
  return (
    <section className={card}>
      <h3 className="text-sm font-semibold">Similar programs (twins)</h3>
      <p className="text-xs text-muted">
        {twin.n_programs} programs, match level {twin.match_level.replace(/_/g, " ")}. Prior success
        probability {pctRange(twin.prior_pos)}.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {twin.twins.map((t) => (
          <li key={t.drug_id}>
            <span className="font-medium">{t.drug}</span> for {t.disease}: {t.max_stage}, {t.status}
            {t.stop_reason ? ` (${t.stop_reason})` : ""}
          </li>
        ))}
      </ul>
      {Object.keys(twin.stop_reasons).length > 0 && (
        <div className="mt-2 text-xs text-muted">
          Stop reasons: {Object.entries(twin.stop_reasons).map(([k, v]) => `${k} (${v})`).join(", ")}
        </div>
      )}
    </section>
  );
}

export function LedgerPanel({ ledger }: { ledger: NonNullable<UnderwritingReport["ledger"]> }) {
  // running base estimate, so each step shows how far it moved the probability
  const rows = ledger.steps.reduce<{ step: (typeof ledger.steps)[number]; running: number }[]>(
    (acc, step) => {
      const before = acc.at(-1)?.running ?? ledger.prior.base;
      const odds = (before / (1 - before)) * step.likelihood_ratio.base;
      return [...acc, { step, running: odds / (1 + odds) }];
    },
    [],
  );
  return (
    <section className={card}>
      <h3 className="text-sm font-semibold">Evidence ledger</h3>
      <p className="text-xs text-muted">Prior times likelihood ratios gives the posterior range.</p>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1">Factor</th>
            <th>Likelihood ratio</th>
            <th>Basis</th>
            <th className="text-right">Running PoS</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <td className="py-1 font-medium">Prior</td>
            <td />
            <td />
            <td className="text-right">{pct(ledger.prior.base)}</td>
          </tr>
          {rows.map(({ step, running }) => (
            <tr key={step.factor} className="border-t border-line">
              <td className="py-1">
                <span className={step.direction === "up" ? "text-emerald-600" : "text-red-600"}>
                  {step.direction === "up" ? "▲" : "▼"}
                </span>{" "}
                {step.factor}
              </td>
              <td>
                ×{step.likelihood_ratio.base.toFixed(2)} ({step.likelihood_ratio.low.toFixed(2)} to{" "}
                {step.likelihood_ratio.high.toFixed(2)})
              </td>
              <td>{step.basis === "sourced" ? (step.citation ?? "sourced") : "assumption"}</td>
              <td className="text-right">{pct(running)}</td>
            </tr>
          ))}
          <tr className="border-t border-line font-medium">
            <td className="py-1">Posterior</td>
            <td colSpan={2} />
            <td className="text-right">{pctRange(ledger.posterior)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function ValuationPanel({ valuation }: { valuation: NonNullable<UnderwritingReport["valuation"]> }) {
  return (
    <section className={card}>
      <h3 className="text-sm font-semibold">Funding to the next milestone</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Next milestone</dt>
        <dd>{valuation.next_milestone}</dd>
        <dt className="text-muted">Capital needed</dt>
        <dd>{usdRange(valuation.capital_to_milestone)}</dd>
        <dt className="text-muted">Time</dt>
        <dd>{months(valuation.time_to_milestone_months)}</dd>
        <dt className="text-muted">rNPV</dt>
        <dd>{usdRange(valuation.rnpv)}</dd>
      </dl>
      {valuation.assumptions.length > 0 && (
        <div className="mt-2 text-xs text-muted">
          Assumptions: {valuation.assumptions.map((a) => `${a.name} (${a.basis})`).join(", ")}
        </div>
      )}
    </section>
  );
}
