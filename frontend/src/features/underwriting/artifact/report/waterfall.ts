import type { LedgerStep, Range, UnderwritingReport } from "../../../../api/types";

type Ledger = NonNullable<UnderwritingReport["ledger"]>;

export interface WaterfallStep {
  step: LedgerStep;
  /** running probability before and after this step, as the backend computed it */
  start: number;
  end: number;
  /** the running low and high after this step */
  lowEnd: number;
  highEnd: number;
}

export interface Waterfall {
  prior: Range;
  posterior: Range;
  steps: WaterfallStep[];
  /** where the last step ends; the prior when there are no steps */
  chainedEnd: number;
  /** last step's end minus the posterior base */
  drift: number;
  /** the steps and the posterior disagree, so the ledger's own numbers are inconsistent */
  driftNotable: boolean;
  axisMax: number;
}

export function buildWaterfall(ledger: Ledger): Waterfall {
  let p = ledger.prior.base;
  const steps = ledger.steps.map((step) => {
    const start = p;
    p = step.pos_after.base;
    return { step, start, end: p, lowEnd: step.pos_after.low, highEnd: step.pos_after.high };
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
    driftNotable: Math.abs(drift) > 0.0005,
    axisMax: Math.min(1, Math.max(...values) * 1.1),
  };
}
