import { useState } from "react";
import { Badge } from "../../../../../components/ui/Badge";
import { RisksPanel } from "../quant/RisksPanel";
import { TranslationStepper } from "../quant/TranslationStepper";
import { ValuationPanel } from "../quant/ValuationPanel";
import { useReportContext, type FocusClaim } from "../reportContext";
import { STANDING_LABEL, type QuestionNode } from "../reportTree";
import { AssessmentView } from "./AssessmentView";
import { BalanceBar } from "./BalanceBar";
import { ClaimRow } from "./ClaimRow";
import { Collapse } from "./Collapse";
import { STANDING_STYLE } from "./treeStyles";

const SHOWN = 4;

function Side({ title, tone, claims, focus }: { title: string; tone: string; claims: QuestionNode["pros"]; focus: FocusClaim | undefined }) {
  const [all, setAll] = useState(false);
  const shown = all || (focus && claims.slice(SHOWN).some((c) => c.id === focus.id)) ? claims : claims.slice(0, SHOWN);
  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
        {title} ({claims.length})
      </h4>
      {claims.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted">Nothing found on this side.</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {shown.map((c) => (
            <ClaimRow key={focus?.id === c.id ? `${c.id}-${focus.nonce}` : c.id} claim={c} focused={focus?.id === c.id} />
          ))}
        </ul>
      )}
      {claims.length > SHOWN && !all && shown.length < claims.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-1.5 text-xs text-brand hover:underline">
          Show {claims.length - SHOWN} more
        </button>
      )}
    </div>
  );
}

function Impact({ pts }: { pts: number }) {
  const sign = pts > 0.05 ? "+" : pts < -0.05 ? "−" : "";
  const tone = pts > 0.05 ? "text-emerald-700" : pts < -0.05 ? "text-red-700" : "text-muted";
  return (
    <div className="shrink-0 text-right" title="How far the evidence for this question moved the probability of success, in percentage points">
      <div className={`text-base font-semibold tabular-nums ${tone}`}>
        {sign}
        {Math.abs(pts).toFixed(1)}
        <span className="text-xs font-normal"> pts</span>
      </div>
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">success odds</div>
    </div>
  );
}

/** One of the four questions: its standing and the scales at a glance, and underneath, the case for and against. */
export function QuestionCard({
  node,
  scale,
  open,
  onToggle,
  focus,
}: {
  node: QuestionNode;
  scale: number;
  open: boolean;
  onToggle: () => void;
  focus: FocusClaim | undefined;
}) {
  const { report } = useReportContext();
  const bodyId = `q-body-${node.id}`;
  const counts = `${node.pros.length} for · ${node.cons.length} against`;
  return (
    <section id={`q-${node.id}`} aria-labelledby={`q-title-${node.id}`} className="report-anchor rounded-xl border border-line bg-surface shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="block w-full rounded-xl p-4 text-left hover:bg-canvas/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`q-title-${node.id}`} className="text-[0.95rem] font-semibold">
                {node.title}
              </h3>
              <Badge className={STANDING_STYLE[node.standing]}>{STANDING_LABEL[node.standing]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{node.headline}</p>
          </div>
          {node.impact && node.impact.steps.length > 0 && <Impact pts={node.impact.pts} />}
          <span className="mt-1 shrink-0 text-sm text-muted" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <BalanceBar pro={node.balance.pro} con={node.balance.con} scale={scale} label={`${counts}. Weighted by confidence: ${node.balance.pro} for, ${node.balance.con} against`} />
          <span className="shrink-0 text-xs text-muted">{counts}</span>
        </div>
      </button>

      <Collapse open={open} id={bodyId}>
        <div className="space-y-4 border-t border-line p-4">
          <p className="text-xs text-muted">
            {node.ask} Standing: {node.basis}.
          </p>
          {node.sections.map((s) => (
            <div key={s.section}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{s.title}</h4>
              {s.status === "insufficient_evidence" ? (
                <p className="mt-1 text-sm text-muted">Not enough public evidence to say. {s.summary}</p>
              ) : (
                <p className="mt-1 text-sm">{s.summary}</p>
              )}
            </div>
          ))}

          {node.assessment && <AssessmentView assessment={node.assessment} hideHeadline={node.headline === node.assessment.headline} />}
          {node.id === "works" && report.translation_chain.length > 0 && <TranslationStepper chain={report.translation_chain} />}
          {node.id === "funding" && report.valuation && <ValuationPanel valuation={report.valuation} />}

          <div className="grid gap-4 @2xl:grid-cols-2">
            <Side title="For" tone="bg-emerald-500" claims={node.pros} focus={focus} />
            <Side title="Against" tone="bg-red-500" claims={node.cons} focus={focus} />
          </div>

          {node.neutral.length > 0 && (
            <details className="rounded-lg border border-line px-3 py-2" open={node.neutral.some((c) => c.id === focus?.id) || undefined}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Context ({node.neutral.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {node.neutral.map((c) => (
                  <ClaimRow key={focus?.id === c.id ? `${c.id}-${focus.nonce}` : c.id} claim={c} focused={focus?.id === c.id} />
                ))}
              </ul>
            </details>
          )}

          {node.risks.length > 0 && <RisksPanel risks={node.risks} />}

          {node.unknowns.length > 0 && (
            <div className="text-xs text-muted">
              <span className="font-medium">What we could not establish:</span>
              <ul className="list-disc pl-4">
                {node.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Collapse>
    </section>
  );
}
