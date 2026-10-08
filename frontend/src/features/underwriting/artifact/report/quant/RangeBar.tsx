import type { Range } from "../../../../../api/types";
import { Measured } from "./Measured";

/** low to high as a bar, base as a marker, a zero line when the range crosses it. Pure SVG. */
export function RangeBar({
  range,
  format,
  label,
  min,
  max,
}: {
  range: Range;
  format: (value: number) => string;
  label: string;
  min?: number;
  max?: number;
}) {
  const lo = Math.min(min ?? range.low, range.low, 0);
  const hi = Math.max(max ?? range.high, range.high);
  const span = hi - lo || 1;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span>
          <strong>{format(range.base)}</strong>{" "}
          <span className="text-xs text-muted">
            ({format(range.low)} to {format(range.high)})
          </span>
        </span>
      </div>
      <Measured>
        {(w) => {
          const x = (v: number) => 6 + ((v - lo) / span) * (w - 12);
          return (
            <svg width={w} height="22" viewBox={`0 0 ${w} 22`} className="mt-1 max-w-full" role="img" aria-label={`${label}: ${format(range.low)} to ${format(range.high)}, base ${format(range.base)}`}>
              <rect x="0" y="9" width={w} height="4" rx="2" className="fill-line" />
              {lo < 0 && <line x1={x(0)} x2={x(0)} y1="3" y2="19" className="stroke-muted" strokeDasharray="2 2" />}
              <rect x={x(range.low)} y="7" width={Math.max(x(range.high) - x(range.low), 2)} height="8" rx="3" className="fill-brand/30" />
              <circle cx={x(range.base)} cy="11" r="4.5" className="fill-brand stroke-white" strokeWidth="1.5" />
            </svg>
          );
        }}
      </Measured>
    </div>
  );
}
