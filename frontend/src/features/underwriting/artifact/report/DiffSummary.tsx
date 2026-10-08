import { Badge } from "../../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE, humanize, pct } from "../../../../lib/format";
import type { DiffView } from "./diffView";

function Decision({ view }: { view: DiffView }) {
  if (!view.decisionBefore || !view.decisionAfter) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge className={DECISION_STYLE[view.decisionBefore]}>{DECISION_LABEL[view.decisionBefore]}</Badge>
      <span aria-label="became">→</span>
      <Badge className={DECISION_STYLE[view.decisionAfter]}>{DECISION_LABEL[view.decisionAfter]}</Badge>
    </span>
  );
}

function pos(view: DiffView): string | null {
  if (!view.posBefore || !view.posAfter) return null;
  const delta = (view.posDelta ?? 0) * 100;
  const sign = delta > 0 ? "+" : "";
  return `PoS ${pct(view.posBefore.base)} → ${pct(view.posAfter.base)} (${sign}${delta.toFixed(1)} pts)`;
}

/** One line for the version bar. */
export function DiffSummaryCompact({ view }: { view: DiffView }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm" data-testid="diff-badge">
      <Decision view={view} />
      {!view.decisionChanged && <span className="text-muted">decision unchanged</span>}
      {pos(view) && <span className="text-muted">{pos(view)}</span>}
      <span className="text-muted">{view.recomputedNodes.length} steps recomputed</span>
      {view.sections.length > 0 && <span className="text-muted">{view.sections.length} sections changed</span>}
    </span>
  );
}

/** The banner at the top of a corrected report: what the correction did. */
export function DiffSummaryFull({
  view,
  onJumpClaim,
  onJumpSection,
}: {
  view: DiffView;
  onJumpClaim: (claimId: string) => void;
  onJumpSection: (sectionId: string) => void;
}) {
  const tone = view.decisionChanged ? "border-violet-400 bg-violet-50" : "border-line bg-surface";
  return (
    <section role="region" aria-labelledby="changed-h" className={`rounded-lg border-2 p-3 ${tone}`}>
      <h3 id="changed-h" className="text-sm font-semibold">
        What changed after your correction
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <Decision view={view} />
        <span className={view.decisionChanged ? "font-semibold" : "text-muted"}>
          {view.decisionChanged ? "The decision changed." : "The decision did not change."}
        </span>
        {pos(view) && <span>{pos(view)}</span>}
        {view.unchanged && <span className="text-muted">Nothing else changed.</span>}
      </div>
      {view.sections.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Changed sections:</span>
          {view.sections.map((s) => (
            <button key={s.id} type="button" onClick={() => onJumpSection(s.id)} className="rounded-full border border-violet-300 bg-surface px-2 py-0.5 text-violet-900 hover:border-violet-500">
              {s.title}
            </button>
          ))}
        </div>
      )}
      {view.added.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-muted">Added claims ({view.added.length}):</span>
          <ul className="mt-1 space-y-1">
            {view.added.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onJumpClaim(c.id)} className="text-left text-emerald-800 hover:underline">
                  + {c.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.removed.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-muted">Removed claims ({view.removed.length}):</span>
          <ul className="mt-1 space-y-1">
            {view.removed.map((c) => (
              <li key={c.id} className="text-red-800 line-through">
                − {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">{view.recomputedNodes.length} steps recomputed</summary>
        <p className="mt-1">{view.recomputedNodes.map(humanize).join(", ")}</p>
      </details>
    </section>
  );
}
