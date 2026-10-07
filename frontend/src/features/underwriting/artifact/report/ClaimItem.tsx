import { useState } from "react";
import type { Claim, UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";

const STANCE: Record<Claim["stance"], string> = {
  pro: "border-emerald-300 bg-emerald-50 text-emerald-800",
  con: "border-red-300 bg-red-50 text-red-800",
  neutral: "border-slate-300 bg-slate-50 text-slate-700",
};

export function EvidenceCard({ evidenceId, report }: { evidenceId: string; report: UnderwritingReport }) {
  const evidence = report.evidence[evidenceId];
  const source = evidence ? report.sources[evidence.source_id] : undefined;
  if (!evidence || !source) {
    return <li className="rounded border border-dashed border-red-300 p-2 text-xs text-red-700">Evidence {evidenceId} is not part of this run.</li>;
  }
  return (
    <li className="rounded border border-line bg-white p-2 text-sm">
      <blockquote className="border-l-2 border-brand pl-2 italic">{evidence.excerpt}</blockquote>
      {evidence.locator && <div className="mt-1 text-xs text-muted">at {evidence.locator}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge className="border-slate-300 text-slate-600">{source.type.replace(/_/g, " ")}</Badge>
        {source.url ? (
          <a className="font-medium text-brand hover:underline" href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
        ) : (
          <span className="font-medium">{source.title}</span>
        )}
        <span className="text-muted">{source.publisher}</span>
        {Object.entries(source.identifiers).map(([k, v]) => (
          <span key={k} className="text-muted">
            {k}: {v}
          </span>
        ))}
      </div>
    </li>
  );
}

export function ClaimItem({ claim, report }: { claim: Claim; report: UnderwritingReport }) {
  const [open, setOpen] = useState(false);
  const muted = claim.status === "rejected";
  return (
    <li className={`rounded-md border border-line bg-white p-2 ${muted ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "hide evidence" : "show evidence"}
          className="mt-0.5 w-4 text-muted"
        >
          {open ? "▾" : "▸"}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-sm ${muted ? "line-through" : ""}`}>{claim.text}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge className={STANCE[claim.stance]}>{claim.stance}</Badge>
            <Badge className="border-slate-300 text-slate-700">{claim.label}</Badge>
            <Badge className="border-slate-300 text-slate-700">{claim.confidence} confidence</Badge>
            {claim.status !== "accepted" && (
              <Badge className={claim.status === "rejected" ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800"}>
                {claim.status}
              </Badge>
            )}
            <Badge className="border-slate-200 text-muted">{claim.evidence_ids.length} evidence</Badge>
          </div>
          {claim.rejection_reason && <div className="mt-1 text-xs text-muted">{claim.rejection_reason}</div>}
        </div>
      </div>
      {open && (
        <ul className="ml-6 mt-2 space-y-2">
          {claim.evidence_ids.length === 0 && (
            <li className="text-xs text-muted">No evidence cited. {claim.label === "hypothesis" ? "Labelled a hypothesis." : ""}</li>
          )}
          {claim.evidence_ids.map((id) => (
            <EvidenceCard key={id} evidenceId={id} report={report} />
          ))}
        </ul>
      )}
    </li>
  );
}
