import type { Risk } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { humanize } from "../../../../../lib/format";
import { useReportContext } from "../reportContext";

const SEVERITY_ORDER: Risk["severity"][] = ["high", "medium", "low"];
const SEVERITY_STYLE: Record<Risk["severity"], string> = {
  high: "border-red-300 bg-red-50 text-red-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-slate-300 bg-slate-50 text-slate-700",
};

export function RisksPanel({ risks }: { risks: Risk[] }) {
  const { jumpToClaim } = useReportContext();
  const sorted = [...risks].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const categories = [...new Set(sorted.map((r) => r.category))];
  return (
    <section className="rounded-sm border border-line bg-surface p-3" aria-labelledby="risks-h">
      <h3 id="risks-h" className="text-base font-semibold">
        Key risks
      </h3>
      <div className="mt-2 space-y-3">
        {categories.map((category) => (
          <div key={category}>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{humanize(category)}</h4>
            <ul className="mt-1 space-y-1.5">
              {sorted
                .filter((r) => r.category === category)
                .map((r) => (
                  <li key={r.text} className="flex flex-wrap items-start gap-2 text-sm">
                    <Badge className={SEVERITY_STYLE[r.severity]}>{r.severity}</Badge>
                    <span className="min-w-0 flex-1">{r.text}</span>
                    {r.claim_ids.map((id) => (
                      <button key={id} type="button" onClick={() => jumpToClaim(id)} className="rounded-full border border-line px-2 py-0.5 text-xs text-brand hover:border-brand">
                        claim
                      </button>
                    ))}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
