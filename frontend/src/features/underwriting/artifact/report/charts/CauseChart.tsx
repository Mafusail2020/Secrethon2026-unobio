import type { EvidenceLedger } from "../../../../../api/types";
import { causeRows } from "./chartData";

const MOVE: Record<"up" | "down" | "same", { bar: string; note: string }> = {
  up: { bar: "bg-red-500", note: "riskier" },
  down: { bar: "bg-emerald-500", note: "safer" },
  same: { bar: "bg-slate-400", note: "unmoved" },
};

/** Where the chance of failing comes from, cause by cause: the share before the evidence, and after it. */
export function CauseChart({ ledger }: { ledger: EvidenceLedger }) {
  const rows = causeRows(ledger);
  if (rows.length === 0) return null;
  const top = Math.max(...rows.flatMap((r) => [r.before, r.after])) || 1;
  return (
    <section className="rounded-sm border border-line bg-surface p-3" aria-labelledby="causes-h">
      <h3 id="causes-h" className="text-base font-semibold">
        Where the risk comes from
      </h3>
      <p className="text-xs text-muted">How much of the chance of failing each cause stands for, before the evidence and after it.</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.cause} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-sm" aria-label={`${r.label}: ${MOVE[r.change].note} after the evidence`}>
            <span className="font-medium">{r.label}</span>
            <span className="space-y-1">
              <span className="block h-2 rounded-sm bg-slate-100" title="before the evidence">
                <span className="block h-full rounded-sm bg-slate-300" style={{ width: `${(r.before / top) * 100}%` }} />
              </span>
              <span className="block h-2 rounded-sm bg-slate-100" title={`after the evidence: ${MOVE[r.change].note}`}>
                <span className={`block h-full rounded-sm ${MOVE[r.change].bar}`} style={{ width: `${(r.after / top) * 100}%` }} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-slate-300" aria-hidden="true" /> before the evidence
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-red-500" aria-hidden="true" /> after, riskier
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-emerald-500" aria-hidden="true" /> after, safer
        </span>
      </p>
    </section>
  );
}
