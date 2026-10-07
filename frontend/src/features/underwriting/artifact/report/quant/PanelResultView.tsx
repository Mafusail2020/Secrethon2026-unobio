import type { PanelResult } from "../../../../../api/types";

/** Candidates from independent models side by side, then what they agreed and disagreed on. */
export function PanelResultView({ panel }: { panel: PanelResult }) {
  const agreement = Math.round(panel.agreement * 100);
  return (
    <div className="mt-2 rounded-md border border-line bg-canvas/50 p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Model panel ({panel.candidates.length} candidates)</span>
        <span className="flex items-center gap-2">
          Agreement {agreement}%
          <svg viewBox="0 0 100 6" className="h-1.5 w-20" role="img" aria-label={`Agreement ${agreement}%`}>
            <rect width="100" height="6" rx="3" className="fill-line" />
            <rect width={agreement} height="6" rx="3" className={agreement >= 70 ? "fill-emerald-500" : "fill-amber-500"} />
          </svg>
        </span>
      </div>
      <ul className="mt-2 grid gap-2 @xl:grid-cols-2">
        {panel.candidates.map((c) => (
          <li key={c.model} className="rounded border border-line bg-white p-2 text-xs">
            <div className="font-medium">{c.model}</div>
            <p>{c.summary}</p>
            {c.decision_hint && <p className="mt-1 text-muted">Leans: {c.decision_hint}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        <span className="font-medium">Consensus:</span> {panel.consensus}
      </p>
      {panel.disagreements.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
          {panel.disagreements.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
