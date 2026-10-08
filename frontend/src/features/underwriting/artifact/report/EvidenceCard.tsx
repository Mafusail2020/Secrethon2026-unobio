import type { Claim } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { correctionTargetFor } from "./correctionTarget";
import { useReportContext } from "./reportContext";

/** One piece of evidence: the verbatim quote, where it sits in the source, and a working link. */
export function EvidenceCard({ evidenceId, claim }: { evidenceId: string; claim: Claim }) {
  const { report, graph, canCorrect, openCorrection } = useReportContext();
  const evidence = report.evidence[evidenceId];
  const source = evidence ? report.sources[evidence.source_id] : undefined;
  if (!evidence || !source) {
    return (
      <li className="rounded border border-dashed border-red-300 p-2 text-xs text-red-700">
        Evidence {evidenceId} is not part of this run.
      </li>
    );
  }
  const target = graph ? correctionTargetFor(claim, graph) : undefined;
  return (
    <li className="rounded-md border border-line bg-canvas/50 p-2 text-sm">
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
        <button
          type="button"
          disabled={!canCorrect || !target}
          onClick={() =>
            target &&
            openCorrection({
              node: target.node,
              note: target.note,
              text: `This evidence should not support the claim: "${evidence.excerpt.slice(0, 160)}"\nBecause: `,
              exclude: [evidence.id],
            })
          }
          title={canCorrect ? "Exclude this evidence and re-run" : "Corrections open once the run has completed"}
          className="ml-auto rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-red-300 hover:text-red-700 disabled:opacity-50"
        >
          This is wrong
        </button>
      </div>
    </li>
  );
}
