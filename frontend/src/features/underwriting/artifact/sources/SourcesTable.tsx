import { Fragment, useMemo, useState } from "react";
import type { UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { buildSourceRows, filterSourceRows, sortRows, type SortDir, type SortKey } from "./sourcesView";

const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "title", label: "Source" },
  { key: "type", label: "Type" },
  { key: "publisher", label: "Publisher" },
  { key: "published", label: "Published" },
  { key: "retrieved", label: "Retrieved" },
  { key: "claims", label: "Cited by", right: true },
];

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

export function SourcesTable({ report, onOpenClaim }: { report: UnderwritingReport; onOpenClaim: (claimId: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "claims", dir: "desc" });
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | undefined>();

  const rows = useMemo(() => buildSourceRows(report), [report]);
  const types = useMemo(() => [...new Set(rows.map((r) => r.source.type))].sort(), [rows]);
  const shown = useMemo(() => sortRows(filterSourceRows(rows, { type, query }), sort.key, sort.dir), [rows, type, query, sort]);

  if (rows.length === 0) return <p className="p-4 text-sm text-muted">No sources in this run.</p>;

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "claims" ? "desc" : "asc" }));

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs" role="search" aria-label="Filter sources">
        <label className="flex items-center gap-1">
          Type
          <select className="rounded border border-line bg-surface px-1.5 py-0.5" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">all</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="sr-only">Search sources</span>
          <input type="search" placeholder="Search title, publisher, id" value={query} onChange={(e) => setQuery(e.target.value)} className="w-56 rounded border border-line bg-surface px-1.5 py-0.5" />
        </label>
        <span className="text-muted" role="status">
          {shown.length} of {rows.length} sources
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Sources used in this report</caption>
          <thead className="text-xs uppercase text-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-2 ${c.right ? "text-right" : ""}`}>
                  <button type="button" onClick={() => toggle(c.key)} className="uppercase hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    {c.label}
                    {sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
              <th scope="col" className="py-2">Identifiers</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted">
                  No sources match these filters.
                </td>
              </tr>
            )}
            {shown.map(({ source: s, claimIds, evidenceCount }) => (
              <Fragment key={s.id}>
                <tr className="border-t border-line align-top">
                  <td className="py-2 pr-2">
                    {s.url ? (
                      <a className="font-medium text-brand hover:underline" href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                    {s.type === "user_provided" && <Badge className="ml-2 border-violet-300 bg-violet-50 text-violet-800">you provided</Badge>}
                    <div className="text-xs text-muted">{evidenceCount} evidence item{evidenceCount === 1 ? "" : "s"}</div>
                  </td>
                  <td>
                    <Badge className="border-slate-300 text-slate-700">{s.type.replace(/_/g, " ")}</Badge>
                  </td>
                  <td>{s.publisher}</td>
                  <td className="text-xs text-muted">{date(s.published_at)}</td>
                  <td className="text-xs text-muted">{date(s.retrieved_at)}</td>
                  <td className="text-right">
                    {claimIds.length === 0 ? (
                      <span className="text-muted">0</span>
                    ) : (
                      <button type="button" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? undefined : s.id)} className="rounded-full border border-line px-2 py-0.5 text-xs text-brand hover:border-brand">
                        {claimIds.length} claim{claimIds.length === 1 ? "" : "s"}
                      </button>
                    )}
                  </td>
                  <td className="text-xs text-muted">
                    {Object.entries(s.identifiers).map(([k, v]) => (
                      <div key={k}>
                        {k}: {v}
                      </div>
                    ))}
                  </td>
                </tr>
                {open === s.id && (
                  <tr className="bg-canvas/50">
                    <td colSpan={7} className="px-3 py-2">
                      <ul className="space-y-1 text-xs">
                        {claimIds.map((id) => (
                          <li key={id}>
                            <button type="button" onClick={() => onOpenClaim(id)} className="text-left text-brand hover:underline">
                              {report.claims[id]?.text ?? id}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
