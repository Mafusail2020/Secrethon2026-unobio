import type { SectionResult } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { humanize } from "../../../../lib/format";
import { ClaimCard } from "./ClaimCard";
import { PanelResultView } from "./quant/PanelResultView";
import { useReportContext } from "./reportContext";

const STATUS: Record<SectionResult["status"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800",
  partial: "border-amber-300 bg-amber-50 text-amber-800",
  insufficient_evidence: "border-red-300 bg-red-50 text-red-700",
};

export function Section({ result }: { result: SectionResult }) {
  const { report, focus } = useReportContext();
  const insufficient = result.status === "insufficient_evidence";
  return (
    <section id={`section-${result.section}`} aria-labelledby={`h-${result.section}`} className="scroll-mt-32 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`h-${result.section}`} className="text-sm font-semibold">
          {result.title}
        </h3>
        <Badge className={STATUS[result.status]}>{humanize(result.status)}</Badge>
      </div>
      {insufficient ? (
        <div role="note" className="mt-2 rounded-md border border-dashed border-red-300 bg-red-50/50 p-3 text-sm">
          <p className="font-medium text-red-900">Not enough public evidence</p>
          <p className="text-xs text-muted">Public sources could not answer this section well enough to make claims. Saying so is the honest answer; it is not a gap in the analysis.</p>
          {result.summary && <p className="mt-2 text-sm text-muted">{result.summary}</p>}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">{result.summary}</p>
      )}
      {result.panel && <PanelResultView panel={result.panel} />}
      {result.key_points.length > 0 && (
        <ul className="mt-2 space-y-3">
          {result.key_points.map((kp) => (
            <li key={kp.text}>
              <div className="text-sm font-medium">{kp.text}</div>
              <ul className="mt-1 space-y-1.5">
                {kp.claim_ids.map((id) => {
                  const claim = report.claims[id];
                  if (!claim) return null;
                  const focused = focus?.id === id;
                  return <ClaimCard key={focused ? `${id}-${focus.nonce}` : id} claim={claim} domId={`claim-${id}`} focused={focused} />;
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {result.unknowns.length > 0 && (
        <div className={`mt-2 text-xs ${insufficient ? "rounded-md bg-canvas p-2" : "text-muted"}`}>
          <span className="font-medium">What we could not establish:</span>
          <ul className="list-disc pl-4">
            {result.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
