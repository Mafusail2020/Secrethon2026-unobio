import type { SectionId, SectionResult, UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE, humanize, pctRange } from "../../../../lib/format";
import { ClaimItem } from "./ClaimItem";
import { LedgerPanel, TwinPanel, ValuationPanel } from "./QuantPanels";

const SECTION_ORDER: SectionId[] = [
  "disease_need",
  "scientific_thesis",
  "translation",
  "clinical_plan",
  "competition",
  "commercial_adoption",
  "capital",
  "risks",
];

const SECTION_STATUS: Record<SectionResult["status"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800",
  partial: "border-amber-300 bg-amber-50 text-amber-800",
  insufficient_evidence: "border-red-300 bg-red-50 text-red-700",
};

const LINK_STATUS: Record<string, string> = {
  supported: "bg-emerald-100 text-emerald-800",
  weak: "bg-amber-100 text-amber-800",
  missing: "bg-slate-100 text-slate-600",
  contradicted: "bg-red-100 text-red-800",
};

function Section({ result, report }: { result: SectionResult; report: UnderwritingReport }) {
  return (
    <section className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{result.title}</h3>
        <Badge className={SECTION_STATUS[result.status]}>{humanize(result.status)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{result.summary}</p>
      {result.panel && (
        <p className="mt-1 text-xs text-muted">
          Panel of {result.panel.candidates.length}, {Math.round(result.panel.agreement * 100)}% agreement:{" "}
          {result.panel.consensus}
        </p>
      )}
      {result.key_points.length > 0 && (
        <ul className="mt-2 space-y-2">
          {result.key_points.map((kp) => (
            <li key={kp.text}>
              <div className="text-sm font-medium">{kp.text}</div>
              <ul className="mt-1 space-y-1">
                {kp.claim_ids.map((id) => {
                  const claim = report.claims[id];
                  return claim ? <ClaimItem key={id} claim={claim} report={report} /> : null;
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {result.unknowns.length > 0 && (
        <div className="mt-2 text-xs text-muted">
          <span className="font-medium">Unknown:</span> {result.unknowns.join("; ")}
        </div>
      )}
    </section>
  );
}

export function ReportView({ report }: { report: UnderwritingReport }) {
  const { verdict, meta } = report;
  const claims = Object.values(report.claims);
  return (
    <div className="space-y-4 p-4">
      <header className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={`px-3 py-1 text-base ${DECISION_STYLE[verdict.decision]}`}>{DECISION_LABEL[verdict.decision]}</Badge>
          <span className="text-sm text-muted">{verdict.confidence} confidence</span>
          <span className="text-sm">
            Probability of success <strong>{pctRange(report.pos)}</strong>
          </span>
          {meta.synthetic && (
            <Badge className="border-amber-300 bg-amber-50 text-amber-800">synthetic fixture data</Badge>
          )}
        </div>
        <h2 className="mt-3 text-lg font-semibold">
          {report.program.mechanism} in {report.program.indication}
        </h2>
        <p className="mt-1 text-sm">{verdict.rationale}</p>
        <ul className="mt-3 space-y-1">
          {verdict.reason_codes.map((rc) => (
            <li key={rc.code} className="flex items-start gap-2 text-sm">
              <span className={rc.direction === "positive" ? "text-emerald-600" : "text-red-600"}>
                {rc.direction === "positive" ? "▲" : "▼"}
              </span>
              <span>
                <span className="font-medium">{humanize(rc.code.toLowerCase())}</span>: {rc.text}
              </span>
            </li>
          ))}
        </ul>
        {verdict.conditions.length > 0 && (
          <div className="mt-3 text-sm">
            <span className="font-medium">Conditions:</span>
            <ul className="list-disc pl-5">
              {verdict.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {report.twin_stats && <TwinPanel twin={report.twin_stats} />}
        {report.valuation && <ValuationPanel valuation={report.valuation} />}
      </div>
      {report.ledger && <LedgerPanel ledger={report.ledger} />}

      {report.translation_chain.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-3">
          <h3 className="text-sm font-semibold">Translation chain</h3>
          <ol className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {report.translation_chain.map((link, i) => (
              <li key={link.step} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted">→</span>}
                <span className={`rounded px-2 py-1 ${LINK_STATUS[link.status]}`}>
                  {humanize(link.step)}: {link.status}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {SECTION_ORDER.flatMap((id) => {
        const result = report.sections[id];
        return result ? [<Section key={id} result={result} report={report} />] : [];
      })}

      {report.key_risks.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-3">
          <h3 className="text-sm font-semibold">Key risks</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {report.key_risks.map((r) => (
              <li key={r.text}>
                <Badge className="mr-2 border-slate-300 text-slate-700">
                  {r.category.replace(/_/g, " ")} · {r.severity}
                </Badge>
                {r.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(report.critical_unknowns.length > 0 || report.diligence_questions.length > 0) && (
        <section className="rounded-lg border border-line bg-white p-3">
          <h3 className="text-sm font-semibold">What we still need to know</h3>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {report.critical_unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <ol className="mt-3 space-y-2 text-sm">
            {report.diligence_questions.map((q) => (
              <li key={q.question}>
                <div className="font-medium">{q.question}</div>
                <div className="text-xs text-muted">
                  {q.why_it_matters} Needs: {q.requires.map(humanize).join(", ") || "n/a"}.
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="rounded-lg border border-line bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">All claims ({claims.length})</summary>
        <ul className="mt-2 space-y-1">
          {claims.map((claim) => (
            <ClaimItem key={claim.id} claim={claim} report={report} />
          ))}
        </ul>
      </details>

      <footer className="pb-4 text-xs text-muted">
        run {report.run_id} · {meta.models_used.join(", ") || "no model calls"} · {meta.effort}
        {meta.panel_size ? ` (panel of ${meta.panel_size})` : ""} · {meta.tokens_in + meta.tokens_out} tokens ·{" "}
        {meta.cost_usd === null ? "cost unknown (no prices)" : `$${meta.cost_usd.toFixed(4)}`} · {meta.duration_s}s ·{" "}
        {meta.cache_hits} cache hits
        {meta.failed_nodes.length > 0 && ` · degraded: ${meta.failed_nodes.join(", ")}`}
      </footer>
    </div>
  );
}
