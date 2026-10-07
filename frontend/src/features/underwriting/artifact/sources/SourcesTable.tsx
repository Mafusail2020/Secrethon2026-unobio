import type { UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";

export function SourcesTable({ report }: { report: UnderwritingReport }) {
  const evidenceBySource = new Map<string, number>();
  for (const e of Object.values(report.evidence)) {
    evidenceBySource.set(e.source_id, (evidenceBySource.get(e.source_id) ?? 0) + 1);
  }
  const sources = Object.values(report.sources);
  if (sources.length === 0) return <p className="p-4 text-sm text-muted">No sources in this run.</p>;
  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-2">Source</th>
            <th>Type</th>
            <th>Publisher</th>
            <th>Identifiers</th>
            <th>Retrieved</th>
            <th className="text-right">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-t border-line align-top">
              <td className="py-2 pr-2">
                {s.url ? (
                  <a className="font-medium text-brand hover:underline" href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </td>
              <td>
                <Badge className="border-slate-300 text-slate-700">{s.type.replace(/_/g, " ")}</Badge>
              </td>
              <td>{s.publisher}</td>
              <td className="text-xs text-muted">
                {Object.entries(s.identifiers).map(([k, v]) => (
                  <div key={k}>
                    {k}: {v}
                  </div>
                ))}
              </td>
              <td className="text-xs text-muted">{new Date(s.retrieved_at).toLocaleDateString()}</td>
              <td className="text-right">{evidenceBySource.get(s.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
