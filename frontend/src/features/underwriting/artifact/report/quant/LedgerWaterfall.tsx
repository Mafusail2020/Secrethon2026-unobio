import { useId } from "react";
import type { EvidenceLedger } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { pct, pctRange } from "../../../../../lib/format";
import { buildWaterfall } from "../waterfall";
import { Measured } from "./Measured";

const H = 22;

function Row({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,13rem)_1fr] items-center gap-3 border-t border-line py-1.5 first:border-t-0">
      <div className="min-w-0 text-xs">
        <div className="font-medium">{label}</div>
        {detail}
      </div>
      {children}
    </li>
  );
}

/**
 * Prior, each evidence step, posterior. The posterior is drawn from the data; step bars chain the base
 * likelihood ratios and are labelled indicative when they do not land on it.
 */
export function LedgerWaterfall({ ledger }: { ledger: EvidenceLedger }) {
  const uid = useId();
  const w = buildWaterfall(ledger);
  const hatch = `${uid}-hatch`;
  const scale = (width: number) => (v: number) => 4 + (Math.min(v, w.axisMax) / w.axisMax) * (width - 8);

  const whisker = (x: (v: number) => number, lo: number, hi: number, cls: string) => (
    <g className={cls} strokeWidth="1.5">
      <line x1={x(lo)} x2={x(hi)} y1={H / 2} y2={H / 2} />
      <line x1={x(lo)} x2={x(lo)} y1={H / 2 - 4} y2={H / 2 + 4} />
      <line x1={x(hi)} x2={x(hi)} y1={H / 2 - 4} y2={H / 2 + 4} />
    </g>
  );

  return (
    <section className="rounded-lg border border-line bg-white p-3" aria-labelledby="ledger-h">
      <h3 id="ledger-h" className="text-sm font-semibold">
        Evidence ledger
      </h3>
      <p className="text-xs text-muted">Where the probability of success starts, what each piece of evidence moved it, and where it lands.</p>
      <ul className="mt-2" aria-label="Ledger steps">
        <Row label="Prior" detail={<span className="text-muted">{pctRange(w.prior)}</span>}>
          <Measured>
            {(width) => {
              const x = scale(width);
              return (
                <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="max-w-full" role="img" aria-label={`Prior ${pctRange(w.prior)}`}>
                  <rect x="0" y="5" width={x(w.prior.base)} height="12" rx="2" className="fill-navy" />
                  {whisker(x, w.prior.low, w.prior.high, "stroke-muted")}
                </svg>
              );
            }}
          </Measured>
        </Row>
        {w.steps.map(({ step, start, end, lowEnd, highEnd }) => {
          const up = step.direction === "up";
          const colour = up ? "emerald" : "red";
          return (
            <Row
              key={step.factor}
              label={step.factor}
              detail={
                <span className="text-muted">
                  ×{step.likelihood_ratio.base.toFixed(2)} ({step.likelihood_ratio.low.toFixed(2)} to {step.likelihood_ratio.high.toFixed(2)}){" "}
                  {step.basis === "sourced" ? (
                    <Badge className="border-emerald-300 text-emerald-800" >sourced</Badge>
                  ) : (
                    <Badge className="border-slate-300 text-slate-600">assumption</Badge>
                  )}
                  {step.citation && <span className="block">{step.citation}</span>}
                </span>
              }
            >
              <Measured>
                {(width) => {
                  const x = scale(width);
                  return (
                    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="max-w-full" role="img" aria-label={`${step.factor}: ${up ? "raises" : "lowers"} the probability from ${pct(start)} to ${pct(end)}, ${step.basis}${step.citation ? `, ${step.citation}` : ""}`}>
                      <title>
                        {step.factor}: ×{step.likelihood_ratio.base.toFixed(2)}, {step.basis}
                        {step.citation ? ` (${step.citation})` : ""}
                      </title>
                      <defs>
                        <pattern id={`${hatch}-${colour}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="4" height="4" className={up ? "fill-emerald-50" : "fill-red-50"} />
                          <line x1="0" y1="0" x2="0" y2="4" strokeWidth="2" className={up ? "stroke-emerald-500" : "stroke-red-500"} />
                        </pattern>
                      </defs>
                      <line x1={x(start)} x2={x(start)} y1="0" y2={H} className="stroke-line" strokeDasharray="2 2" />
                      <rect
                        x={x(Math.min(start, end))}
                        y="5"
                        width={Math.max(Math.abs(x(end) - x(start)), 2)}
                        height="12"
                        rx="2"
                        fill={step.basis === "sourced" ? undefined : `url(#${hatch}-${colour})`}
                        className={step.basis === "sourced" ? (up ? "fill-emerald-500" : "fill-red-500") : up ? "stroke-emerald-500" : "stroke-red-500"}
                        strokeWidth={step.basis === "sourced" ? 0 : 1}
                      />
                      {whisker(x, lowEnd, highEnd, "stroke-muted")}
                    </svg>
                  );
                }}
              </Measured>
            </Row>
          );
        })}
        <Row label="Posterior" detail={<span className="font-medium">{pctRange(w.posterior)}</span>}>
          <Measured>
            {(width) => {
              const x = scale(width);
              return (
                <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="max-w-full" role="img" aria-label={`Posterior ${pctRange(w.posterior)}`}>
                  <rect x="0" y="5" width={x(w.posterior.base)} height="12" rx="2" className="fill-navy" />
                  {whisker(x, w.posterior.low, w.posterior.high, "stroke-muted")}
                </svg>
              );
            }}
          </Measured>
        </Row>
      </ul>
      <div className="mt-1 flex justify-between pl-0 text-[11px] text-muted sm:pl-[calc(13rem+0.75rem)]">
        <span>0%</span>
        <span>{pct(w.axisMax)}</span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>Solid: sourced</span>
        <span>Hatched: assumption</span>
        <span>Whisker: this step's own low and high ratio; prior and posterior show their ranges</span>
      </p>
      {w.driftNotable && (
        <p role="note" className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          The step bars chain the base ratios and end at {pct(w.chainedEnd)}; the posterior is {pct(w.posterior.base)}. The range is propagated with low and high ratios, so the steps are indicative.
        </p>
      )}
    </section>
  );
}
