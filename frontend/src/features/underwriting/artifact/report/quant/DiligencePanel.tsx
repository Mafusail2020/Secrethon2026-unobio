import type { DiligenceQuestion } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { humanize } from "../../../../../lib/format";
import { useReportContext } from "../reportContext";

export function DiligencePanel({ unknowns, questions }: { unknowns: string[]; questions: DiligenceQuestion[] }) {
  const { jumpToClaim } = useReportContext();
  const sorted = [...questions].sort((a, b) => a.priority - b.priority);
  return (
    <section className="rounded-lg border border-line bg-white p-3" aria-labelledby="dd-h">
      <h3 id="dd-h" className="text-sm font-semibold">
        What we still need to know
      </h3>
      {unknowns.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-sm">
          {unknowns.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
      {sorted.length > 0 && (
        <ol className="mt-3 space-y-2.5">
          {sorted.map((q) => (
            <li key={q.question} className="text-sm">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] text-white" aria-label={`Priority ${q.priority}`}>
                  {q.priority}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{q.question}</p>
                  <p className="text-xs text-muted">{q.why_it_matters}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {q.requires.map((r) => (
                      <Badge key={r} className="border-slate-300 text-slate-700">{humanize(r)}</Badge>
                    ))}
                    {q.claim_ids.map((id) => (
                      <button key={id} type="button" onClick={() => jumpToClaim(id)} className="rounded-full border border-line px-2 py-0.5 text-xs text-brand hover:border-brand">
                        claim
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
