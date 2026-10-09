import { months, pct, pctRange, usdRange } from "../../../../../lib/format";
import { LABEL_HELP } from "../labels";
import { Reading } from "./DeckBits";
import type { EvidenceSlide, FundingSlide, ProbabilitySlide, RisksSlide, TwinsSlide } from "./deckModel";

const SLICE: Record<string, string> = {
  extracted: "bg-emerald-600",
  derived: "bg-teal-500",
  inferred: "bg-sky-500",
  modeled: "bg-indigo-400",
  hypothesis: "bg-amber-400",
  unknown: "bg-slate-300",
};

const SEVERITY: Record<string, string> = {
  high: "border-red-300 bg-red-50 text-red-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-slate-300 bg-slate-50 text-slate-700",
};

function Missing({ children }: { children: string }) {
  return <p className="rounded-sm border border-dashed border-line px-5 py-4 text-[17px] text-muted">{children}</p>;
}

export function ProbabilityBody({ slide }: { slide: ProbabilitySlide }) {
  if (slide.steps.length === 0) {
    return <Missing>No evidence ledger was produced, so the chance of success is the reference prior alone.</Missing>;
  }
  const reach = Math.max(1, ...slide.steps.map((s) => Math.abs(s.pts)));
  const top = Math.max(...slide.causes.flatMap((c) => [c.before, c.after]), 0) || 1;
  return (
    <div className="grid h-full grid-cols-[1fr_380px] gap-10">
      <div>
        <p className="text-[16px] text-muted">
          From {slide.prior ? pctRange(slide.prior) : "the reference prior"} to <strong className="text-ink">{pctRange(slide.posterior)}</strong>. Each bar is the percentage points one piece of evidence added or took away.
        </p>
        <ul className="mt-5 space-y-4">
          {slide.steps.map((s) => (
            <li key={s.factor} className="grid grid-cols-[1fr_260px_52px] items-center gap-4 text-[16px]">
              <span>
                {s.factor}
                <span className="ml-2 text-[12px] text-muted">{s.cause}</span>
              </span>
              <span className="relative block h-3.5 rounded-sm bg-slate-100" role="img" aria-label={`${s.factor}: ${s.pts > 0 ? "+" : ""}${s.pts.toFixed(1)} points`}>
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-400" aria-hidden="true" />
                <span
                  className={`absolute inset-y-0 rounded-sm ${s.pts >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-red-500"}`}
                  style={{ width: `${(Math.abs(s.pts) / reach) * 50}%` }}
                />
              </span>
              <span className="text-right text-[14px] tabular-nums text-muted" aria-hidden="true">
                {s.pts > 0 ? "+" : ""}
                {s.pts.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-[17px] font-semibold">Where the risk comes from</h3>
        <p className="text-[13px] text-muted">Share of the chance of failing, before the evidence (grey) and after it.</p>
        <ul className="mt-3 space-y-3">
          {slide.causes.map((c) => (
            <li key={c.cause} className="text-[14px]">
              <span className="font-medium">{c.label}</span>
              <span className="mt-1 block h-2 rounded-sm bg-slate-100">
                <span className="block h-full rounded-sm bg-slate-300" style={{ width: `${(c.before / top) * 100}%` }} />
              </span>
              <span className="mt-1 block h-2 rounded-sm bg-slate-100">
                <span className={`block h-full rounded-sm ${c.change === "up" ? "bg-red-500" : c.change === "down" ? "bg-emerald-500" : "bg-slate-400"}`} style={{ width: `${(c.after / top) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TwinsBody({ slide }: { slide: TwinsSlide }) {
  const stats = slide.stats;
  if (!stats) return <Missing>No history of similar programs was available for this run.</Missing>;
  return (
    <div className="grid h-full grid-cols-[1fr_420px] gap-10">
      <div>
        <p className="text-[17px]">
          {stats.count} similar {stats.count === 1 ? "program" : "programs"}, matched on {stats.matchLevel}. They set the starting chance at <strong>{pctRange(stats.prior)}</strong>.
        </p>
        {stats.count < 5 && <p className="mt-2 text-[14px] text-amber-800">Thin history: with only {stats.count} similar programs this starting point is weak.</p>}
        <table className="mt-4 w-full text-left text-[15px]">
          <thead className="text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="pb-1 font-medium">Program</th>
              <th className="pb-1 font-medium">Indication</th>
              <th className="pb-1 font-medium">Furthest stage</th>
              <th className="pb-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {stats.programs.map((p) => (
              <tr key={`${p.drug}-${p.disease}`} className="border-t border-line">
                <td className="py-1.5 pr-3">{p.drug}</td>
                <td className="py-1.5 pr-3">{p.disease}</td>
                <td className="py-1.5 pr-3">{p.stage}</td>
                <td className="py-1.5">{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="text-[17px] font-semibold">Why programs stopped</h3>
        {stats.stopReasons.length === 0 ? (
          <p className="mt-2 text-[15px] text-muted">None stopped, or no reason was recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[15px]">
            {stats.stopReasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-4 border-b border-line pb-1">
                <span>{r.reason}</span>
                <span className="tabular-nums text-muted">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function FundingBody({ slide }: { slide: FundingSlide }) {
  const v = slide.valuation;
  if (!v) return <Missing>No valuation was produced for this run, so what funding costs and returns is not stated.</Missing>;
  return (
    <div className="grid h-full grid-cols-[1fr_1fr] gap-10">
      <div className="space-y-6">
        <p className="text-[19px]">
          Next milestone: <strong>{v.milestone}</strong>
        </p>
        <dl className="space-y-4">
          {[
            ["Capital needed", usdRange(v.capital)],
            ["Time to the milestone", months(v.months)],
            ["Risk-adjusted value", usdRange(v.rnpv)],
          ].map(([term, value]) => (
            <div key={term} className="border-b border-line pb-3">
              <dt className="text-[13px] font-medium uppercase tracking-wide text-muted">{term}</dt>
              <dd className="font-serif text-[30px] leading-tight">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-5">
        {v.inflections.length > 0 && (
          <div>
            <h3 className="text-[17px] font-semibold">What would move the value</h3>
            <ul className="mt-1 list-disc space-y-1 pl-6 text-[16px]">
              {v.inflections.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        {v.assumptions.length > 0 && (
          <div>
            <h3 className="text-[17px] font-semibold">Assumptions behind the value</h3>
            <ul className="mt-1 space-y-1 text-[14px]">
              {v.assumptions.map((a) => (
                <li key={a.name} className="flex justify-between gap-4 border-b border-line pb-1">
                  <span>{a.name}</span>
                  <span className="text-muted">
                    {a.value} · {a.basis}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function EvidenceBody({ slide }: { slide: EvidenceSlide }) {
  const c = slide.counts;
  return (
    <div className="grid h-full grid-cols-2 gap-10">
      <div>
        <p className="text-[20px] leading-snug">
          <strong>{pct(slide.grounded)}</strong> of the counted claims are facts read from a source or computed from one.
        </p>
        {slide.mix.length > 0 && (
          <>
            <div className="mt-4 flex h-5 overflow-hidden rounded-sm bg-slate-100" role="img" aria-label={slide.mix.map((s) => `${s.count} ${s.label}`).join(", ")}>
              {slide.mix.map((s) => (
                <span key={s.label} className={SLICE[s.label]} style={{ width: `${s.share * 100}%` }} />
              ))}
            </div>
            <ul className="mt-4 space-y-1.5 text-[15px]">
              {slide.mix.map((s) => (
                <li key={s.label} className="flex items-baseline gap-2">
                  <span className={`h-3 w-3 shrink-0 rounded-sm ${SLICE[s.label]}`} aria-hidden="true" />
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[13px] text-muted">{LABEL_HELP[s.label].body}</span>
                  <span className="ml-auto tabular-nums">{s.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[15px]">
          {[
            ["Claims counted", c.counted],
            ["Downgraded by the gate", c.downgraded],
            ["Rejected by the gate", c.rejected],
            ["Sources", c.sources],
            ["Evidence items", c.evidence],
          ].map(([term, value]) => (
            <div key={term} className="border-b border-line pb-1">
              <dt className="text-[12px] uppercase tracking-wide text-muted">{term}</dt>
              <dd className="font-serif text-[26px] leading-tight">{value}</dd>
            </div>
          ))}
        </dl>
        {slide.sourceKinds.length > 0 && (
          <div>
            <h3 className="text-[17px] font-semibold">What the claims cite</h3>
            <ul className="mt-1 space-y-1 text-[15px]">
              {slide.sourceKinds.map((s) => (
                <li key={s.label} className="flex justify-between gap-4 border-b border-line pb-1">
                  <span>{s.label}</span>
                  <span className="tabular-nums text-muted">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function RisksBody({ slide }: { slide: RisksSlide }) {
  return (
    <div className="grid h-full grid-cols-[1.3fr_1fr] gap-10">
      <div>
        <h3 className="text-[18px] font-semibold">Key risks</h3>
        {slide.reading?.length ? (
          <div className="mt-3">
            <Reading lines={slide.reading} />
          </div>
        ) : slide.risks.length === 0 ? (
          <p className="mt-2 text-[16px] italic text-muted">The report names none.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {slide.risks.map((r) => (
              <li key={`${r.category}-${r.text}`} className="flex items-start gap-3 text-[19px] leading-snug">
                <span className={`mt-0.5 w-[72px] shrink-0 rounded-full border px-2 py-px text-center text-[12px] font-medium ${SEVERITY[r.severity]}`}>{r.severity}</span>
                <span>
                  {r.text}
                  <span className="ml-2 text-[12px] text-muted">{r.category}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-[18px] font-semibold">What we do not know</h3>
        {slide.unknowns.length === 0 ? (
          <p className="mt-2 text-[16px] italic text-muted">The report names none.</p>
        ) : (
          <ul className="mt-3 list-disc space-y-3 pl-6 text-[19px] leading-snug">
            {slide.unknowns.map((u, i) => (
              <li key={`${i}-${u}`}>{u}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
