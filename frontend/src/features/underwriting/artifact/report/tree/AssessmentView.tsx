import type { UnderwritingReport } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { STANDING_LABEL, type Standing } from "../reportTree";
import { STANDING_STYLE } from "./treeStyles";

type Assessment = UnderwritingReport["assessments"][number];

const RATING: Record<Assessment["rating"], Standing> = {
  strong: "favourable",
  moderate: "mixed",
  weak: "unfavourable",
  concerning: "unfavourable",
  unknown: "unknown",
};

const TITLE: Record<Assessment["cause"], string> = { efficacy: "Efficacy check", safety: "Safety check" };

const format = (value: number | null, unit: string | null) => (value === null ? "unknown" : `${Number(value.toFixed(2))}${unit ? ` ${unit}` : ""}`);

/** What the efficacy or safety check found: the numbers behind its rating, and what it could not check. */
export function AssessmentView({ assessment, hideHeadline = false }: { assessment: Assessment; hideHeadline?: boolean }) {
  const standing = RATING[assessment.rating];
  return (
    <section className="rounded-lg border border-line bg-surface p-3" aria-label={TITLE[assessment.cause]}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{TITLE[assessment.cause]}</h4>
        <Badge className={STANDING_STYLE[standing]}>
          {assessment.rating} · {STANDING_LABEL[standing].toLowerCase()}
        </Badge>
      </div>
      {!hideHeadline && <p className="mt-1 text-sm">{assessment.headline}</p>}
      {assessment.metrics.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">Numbers behind the {assessment.cause} rating</caption>
          <tbody>
            {assessment.metrics.map((m) => (
              <tr key={m.key} className="border-t border-line align-top">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {m.label}
                  {m.note && <span className="block text-xs text-muted">{m.note}</span>}
                </th>
                <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{format(m.value, m.unit)}</td>
                <td className="py-1.5 text-right">
                  <Badge className={m.basis === "sourced" ? "border-emerald-300 text-emerald-800" : "border-slate-300 text-slate-600"}>{m.basis}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {assessment.gaps.length > 0 && (
        <div className="mt-2 text-xs text-muted">
          <span className="font-medium">Could not check:</span>
          <ul className="list-disc pl-4">
            {assessment.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
