import type { Claim } from "../../../../../api/types";
import { pct } from "../../../../../lib/format";
import { LABEL_HELP } from "../labels";
import { groundedShare, labelMix } from "./chartData";

const SLICE: Record<Claim["label"], string> = {
  extracted: "bg-emerald-600",
  derived: "bg-teal-500",
  inferred: "bg-sky-500",
  modeled: "bg-indigo-400",
  hypothesis: "bg-amber-400",
  unknown: "bg-slate-300",
};

/** What the claims stand on: facts read from sources and computed from them, or reasoning and belief. */
export function EvidenceMix({ claims }: { claims: Claim[] }) {
  const mix = labelMix(claims);
  if (mix.length === 0) return null;
  const grounded = groundedShare(mix);
  return (
    <section className="rounded-sm border border-line bg-surface p-3" aria-labelledby="mix-h">
      <h3 id="mix-h" className="text-base font-semibold">
        What the claims rest on
      </h3>
      <p className="text-sm">
        <strong>{pct(grounded)}</strong> of the claims are facts read from a source or computed from one.
      </p>
      <div role="img" aria-label={mix.map((s) => `${s.count} ${s.label}`).join(", ")} className="mt-2 flex h-4 overflow-hidden rounded-sm bg-slate-100">
        {mix.map((s) => (
          <span key={s.label} className={SLICE[s.label]} style={{ width: `${s.share * 100}%` }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {mix.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5" title={LABEL_HELP[s.label].body}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${SLICE[s.label]}`} aria-hidden="true" />
            <span className="font-medium">{s.label}</span>
            <span className="ml-auto tabular-nums text-muted">{s.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
