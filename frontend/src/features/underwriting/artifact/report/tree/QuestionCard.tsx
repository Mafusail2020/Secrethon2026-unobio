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
import { Chevron } from "./Chevron";
import { Collapse } from "./Collapse";
import { Preview, SideBox } from "./SideBox";
import { STANDING_EDGE, STANDING_STYLE } from "./treeStyles";

const PEEK = 2;
const SHOWN = 4;

function Claims({ claims, focus }: { claims: QuestionNode["pros"]; focus: FocusClaim | undefined }) {
  const [all, setAll] = useState(false);
  const shown = all || (focus && claims.slice(SHOWN).some((c) => c.id === focus.id)) ? claims : claims.slice(0, SHOWN);
  if (claims.length === 0) return <p className="text-sm italic text-muted">Nothing found on this side.</p>;
  return (
    <>
      <ul className="space-y-1.5">
        {shown.map((c) => (
          <ClaimRow key={focus?.id === c.id ? `${c.id}-${focus.nonce}` : c.id} claim={c} focused={focus?.id === c.id} />
        ))}
      </ul>
      {shown.length < claims.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-1.5 text-xs font-medium text-brand hover:underline">
          Show {claims.length - shown.length} more
        </button>
      )}
    </>
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

/**
 * One of the four questions. Closed, it shows its standing and, side by side, the heaviest claims for and against;
 * open, every claim, with the evidence behind each, and the checks, risks and gaps under them.
 */
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
  const peek = (claims: QuestionNode["pros"]) => ({ texts: claims.slice(0, PEEK).map((c) => c.text), more: Math.max(0, claims.length - PEEK) });
  const forPeek = peek(node.pros);
  const againstPeek = peek(node.cons);
  return (
    <section id={`q-${node.id}`} aria-labelledby={`q-title-${node.id}`} className={`report-anchor rounded-sm border border-l-[6px] border-line bg-surface shadow-sm ${STANDING_EDGE[node.standing]}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="block w-full rounded-t-sm p-4 pb-3 text-left hover:bg-canvas/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`q-title-${node.id}`} className="text-xl font-semibold leading-snug tracking-tight">
                {node.title}
              </h3>
              <Badge className={STANDING_STYLE[node.standing]}>{STANDING_LABEL[node.standing]}</Badge>
            </div>
            <p className="mt-1.5 text-[0.95rem] text-muted">{node.headline}</p>
          </div>
          {node.impact && node.impact.steps.length > 0 && <Impact pts={node.impact.pts} />}
          <Chevron open={open} />
        </div>
        <div className="mt-3">
          <BalanceBar pro={node.balance.pro} con={node.balance.con} scale={scale} label={`${node.pros.length} for, ${node.cons.length} against. Weighted by confidence: ${node.balance.pro} for, ${node.balance.con} against`} />
        </div>
      </button>

      {!open && (
        <button type="button" data-print-hide onClick={onToggle} aria-label={`Open the case: ${node.title}`} className="block w-full px-4 pb-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          <div className="grid gap-3 @2xl:grid-cols-2">
            <SideBox side="for" title="For">
              <Preview {...forPeek} />
            </SideBox>
            <SideBox side="against" title="Against">
              <Preview {...againstPeek} />
            </SideBox>
          </div>
        </button>
      )}

      <Collapse open={open} id={bodyId}>
        <div className="space-y-4 px-4 pb-4">
          <div className="grid gap-3 @2xl:grid-cols-2">
            <SideBox side="for" title="For">
              <Claims claims={node.pros} focus={focus} />
            </SideBox>
            <SideBox side="against" title="Against">
              <Claims claims={node.cons} focus={focus} />
            </SideBox>
          </div>

          <p className="text-xs text-muted">
            {node.ask} Standing: {node.basis}.
          </p>
          {node.sections.map((s) => (
            <div key={s.section}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">{s.title}</h4>
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

          {node.neutral.length > 0 && (
            <details className="rounded-sm border border-line px-3 py-2" open={node.neutral.some((c) => c.id === focus?.id) || undefined}>
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
                {node.unknowns.map((u, i) => (
                  <li key={`${i}-${u}`}>{u}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Collapse>
    </section>
  );
}
