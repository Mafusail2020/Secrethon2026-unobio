import type { Range } from "../../../api/types";
import { pct } from "../../../lib/format";
import { posScale } from "./posScale";

/**
 * Where the probability of success landed: the range as a band, the best estimate as a tick, and the prior it
 * started from (similar programs) as a dashed mark, all on one scale from 0.
 */
export function PosStrip({ pos, prior }: { pos: Range; prior?: Range }) {
  const scale = posScale(pos, prior);
  const label = `Probability of success ${pct(pos.base)}, range ${pct(pos.low)} to ${pct(pos.high)}${
    prior ? `, starting from a prior of ${pct(prior.base)}` : ""
  }, on a scale from 0% to ${pct(scale.max)}`;
  return (
    <figure className="m-0">
      <div role="img" aria-label={label} className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 bg-brand/35"
          style={{ left: `${scale.at(pos.low)}%`, width: `${Math.max(0.6, scale.at(pos.high) - scale.at(pos.low))}%` }}
        />
        {prior && (
          <div
            className="absolute top-0.5 bottom-0.5 w-0 border-l border-dashed border-muted"
            style={{ left: `${scale.at(prior.base)}%` }}
          />
        )}
        <div className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${scale.at(pos.base)}%` }} />
      </div>
      <figcaption className="label-mono mt-1 flex flex-wrap justify-between gap-x-4 text-muted" aria-hidden="true">
        <span>
          range {pct(pos.low)} – {pct(pos.high)}
          {prior && <> · prior {pct(prior.base)}</>}
        </span>
        <span>scale 0 – {pct(scale.max)}</span>
      </figcaption>
    </figure>
  );
}
