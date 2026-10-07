import type { LedgerStep, Range, UnderwritingReport } from "../../../../api/types";

type Ledger = NonNullable<UnderwritingReport["ledger"]>;

export interface WaterfallStep {
  step: LedgerStep;
  /** indicative probability before and after this step, chaining base likelihood ratios */
  start: number;
  end: number;
  /** end value if this one step used its own low and high ratio */
  lowEnd: number;
  highEnd: number;
}

export interface Waterfall {
  prior: Range;
  posterior: Range;
  steps: WaterfallStep[];
  /** where chaining the base ratios from the prior lands; the posterior itself always comes from the data */
  chainedEnd: number;
  /** chained end minus the posterior base */
  drift: number;
  /** the chain and the posterior disagree enough that the steps are only indicative */
  driftNotable: boolean;
  axisMax: number;
}

function apply(p: number, ratio: number): number {
  const q = Math.min(Math.max(p, 0), 1 - 1e-9);
  const odds = (q / (1 - q)) * ratio;
  return odds / (1 + odds);
}

export function buildWaterfall(ledger: Ledger): Waterfall {
  let p = ledger.prior.base;
  const steps = ledger.steps.map((step) => {
    const start = p;
    p = apply(p, step.likelihood_ratio.base);
    return {
      step,
      start,
      end: p,
      lowEnd: apply(start, step.likelihood_ratio.low),
      highEnd: apply(start, step.likelihood_ratio.high),
    };
  });
  const drift = p - ledger.posterior.base;
  const values = [
    ledger.prior.high,
    ledger.posterior.high,
    ...steps.flatMap((s) => [s.start, s.end, s.highEnd]),
  ];
  return {
    prior: ledger.prior,
    posterior: ledger.posterior,
    steps,
    chainedEnd: p,
    drift,
    driftNotable: Math.abs(drift) > Math.max(0.01, 0.1 * ledger.posterior.base),
    axisMax: Math.min(1, Math.max(...values) * 1.1),
  };
}
