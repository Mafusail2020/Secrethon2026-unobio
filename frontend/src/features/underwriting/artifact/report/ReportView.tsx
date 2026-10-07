import { useEffect, useMemo, useState } from "react";
import type { GraphSpec, SectionId, UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { DECISION_LABEL, DECISION_STYLE, humanize, pctRange } from "../../../../lib/format";
import { CorrectionDialog } from "../../correction/CorrectionDialog";
import { ClaimCard } from "./ClaimCard";
import { ClaimFilterBar } from "./ClaimFilterBar";
import { emptyFilters, filterClaims, type ClaimFilters } from "./claimFilters";
import { ExportBar } from "./ExportBar";
import { DiligencePanel } from "./quant/DiligencePanel";
import { LedgerWaterfall } from "./quant/LedgerWaterfall";
import { RisksPanel } from "./quant/RisksPanel";
import { TranslationStepper } from "./quant/TranslationStepper";
import { TwinPanel } from "./quant/TwinPanel";
import { ValuationPanel } from "./quant/ValuationPanel";
import { ReportContext, type CorrectionSeed, type FocusClaim } from "./reportContext";
import { RunDetails } from "./RunDetails";
import { Section } from "./Section";
import { isSyntheticReport } from "./synthetic";
import { useScrollSpy } from "./useScrollSpy";
import { WhatChanged } from "./WhatChanged";

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

const prefersCalm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: "start", behavior: prefersCalm() ? "auto" : "smooth" });
}

export function ReportView({
  report,
  runId,
  graph,
  canCorrect,
  focusClaim,
}: {
  report: UnderwritingReport;
  runId: string;
  graph: GraphSpec | undefined;
  canCorrect: boolean;
  focusClaim?: FocusClaim;
}) {
  const { verdict } = report;
  const [local, setLocal] = useState<FocusClaim | undefined>();
  const [seed, setSeed] = useState<CorrectionSeed | undefined>();
  const [filters, setFilters] = useState<ClaimFilters>(emptyFilters);
  const focus = focusClaim && (!local || focusClaim.nonce > local.nonce) ? focusClaim : local;

  const claims = useMemo(() => Object.values(report.claims), [report.claims]);
  const shownClaims = useMemo(() => filterClaims(claims, filters, report), [claims, filters, report]);
  const inSection = (id: string) => Object.values(report.sections).some((s) => s.key_points.some((kp) => kp.claim_ids.includes(id)));
  const focusInAll = !!focus && !inSection(focus.id);

  const sections = SECTION_ORDER.flatMap((id) => (report.sections[id] ? [report.sections[id]] : []));
  const nav = [
    { id: "overview", label: "Overview" },
    ...(report.translation_chain.length ? [{ id: "translation-chain", label: "Translation chain" }] : []),
    ...sections.map((s) => ({ id: `section-${s.section}`, label: s.title })),
    { id: "risks-unknowns", label: "Risks and unknowns" },
    { id: "all-claims", label: `All claims (${claims.length})` },
    { id: "run-details", label: "Run" },
  ];
  const active = useScrollSpy(nav.map((n) => n.id).join("|"));

  const jumpToClaim = (id: string) => {
    setFilters(emptyFilters);
    setLocal((prev) => ({ id, nonce: Math.max(prev?.nonce ?? 0, focusClaim?.nonce ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`claim-${focus.id}`) ?? document.getElementById(`all-claim-${focus.id}`);
    el?.scrollIntoView({ block: "center", behavior: prefersCalm() ? "auto" : "smooth" });
  }, [focus]);

  // print rules in styles/print.css apply only while a report is on screen
  useEffect(() => {
    document.body.dataset.print = "report";
    return () => {
      delete document.body.dataset.print;
    };
  }, []);

  const synthetic = isSyntheticReport(report);

  return (
    <ReportContext.Provider value={{ report, runId, graph, canCorrect, focus, jumpToClaim, openCorrection: setSeed }}>
      <div className="pb-6">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur" data-print-header>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2">
            <Badge className={`px-3 py-0.5 text-sm ${DECISION_STYLE[verdict.decision]}`}>{DECISION_LABEL[verdict.decision]}</Badge>
            <span className="text-xs text-muted">{verdict.confidence} confidence</span>
            <span className="text-sm">
              Probability of success <strong>{pctRange(report.pos)}</strong>
            </span>
            <div className="ml-auto">
              <ExportBar report={report} />
            </div>
          </div>
          {synthetic && (
            <p role="alert" className="mx-4 mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              Synthetic data: this report contains placeholder content from stub steps, not real research.
            </p>
          )}
          <nav aria-label="Report sections" className="mt-1 flex gap-1 overflow-x-auto px-4 pb-2" data-print-hide>
            {nav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToId(item.id)}
                aria-current={active === item.id ? "location" : undefined}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  active === item.id ? "bg-navy text-white" : "text-muted hover:bg-white hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="space-y-4 p-4">
          {report.meta.parent_run_id && <WhatChanged report={report} onJumpSection={(id) => scrollToId(`section-${id}`)} />}

          <section id="overview" className="scroll-mt-32 space-y-4" aria-label="Overview">
            <div className="rounded-lg border border-line bg-white p-4">
              <h2 className="text-lg font-semibold">
                {report.program.mechanism} in {report.program.indication}
              </h2>
              <p className="mt-1 text-sm">{verdict.rationale}</p>
              <ul className="mt-3 space-y-1">
                {verdict.reason_codes.map((rc) => (
                  <li key={rc.code} className="flex items-start gap-2 text-sm">
                    <span className={rc.direction === "positive" ? "text-emerald-600" : "text-red-600"} aria-hidden="true">
                      {rc.direction === "positive" ? "▲" : "▼"}
                    </span>
                    <span>
                      <span className="sr-only">{rc.direction}: </span>
                      <span className="font-medium">{humanize(rc.code.toLowerCase())}</span>: {rc.text}
                      {rc.claim_ids.map((id) => (
                        <button key={id} type="button" onClick={() => jumpToClaim(id)} className="ml-1 rounded-full border border-line px-1.5 text-xs text-brand hover:border-brand">
                          claim
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {verdict.conditions.length > 0 && (
                <div className="mt-3 text-sm">
                  <span className="font-medium">Conditions to proceed:</span>
                  <ul className="list-disc pl-5">
                    {verdict.conditions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {report.twin_stats ? <TwinPanel twin={report.twin_stats} report={report} /> : <Missing title="Similar programs" why="Historical twin statistics are not available for this run." />}
              {report.valuation ? <ValuationPanel valuation={report.valuation} /> : <Missing title="Funding to the next milestone" why="No valuation was produced for this run." />}
            </div>
            {report.ledger ? <LedgerWaterfall ledger={report.ledger} /> : <Missing title="Evidence ledger" why="No evidence ledger was produced, so the probability above rests on the twin prior alone." />}
          </section>

          {report.translation_chain.length > 0 && (
            <div id="translation-chain" className="scroll-mt-32">
              <TranslationStepper chain={report.translation_chain} />
            </div>
          )}

          {sections.map((s) => (
            <Section key={s.section} result={s} />
          ))}

          <div id="risks-unknowns" className="scroll-mt-32 space-y-4">
            {report.key_risks.length > 0 && <RisksPanel risks={report.key_risks} />}
            {(report.critical_unknowns.length > 0 || report.diligence_questions.length > 0) && (
              <DiligencePanel unknowns={report.critical_unknowns} questions={report.diligence_questions} />
            )}
          </div>

          <details key={focusInAll ? focus.nonce : "all"} id="all-claims" open={focusInAll || undefined} className="scroll-mt-32 rounded-lg border border-line bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold">All claims ({claims.length})</summary>
            <div className="mt-2 space-y-2">
              <ClaimFilterBar claims={claims} filters={filters} shown={shownClaims.length} onChange={setFilters} />
              {shownClaims.length === 0 && <p className="text-sm text-muted">No claims match these filters.</p>}
              <ul className="space-y-1.5">
                {shownClaims.map((claim) => {
                  const focused = focusInAll && focus.id === claim.id;
                  return <ClaimCard key={focused ? `${claim.id}-${focus.nonce}` : claim.id} claim={claim} domId={`all-claim-${claim.id}`} focused={focused} />;
                })}
              </ul>
            </div>
          </details>

          <div id="run-details" className="scroll-mt-32">
            <RunDetails meta={report.meta} runId={report.run_id} />
          </div>
        </div>
      </div>
      {seed && graph && (
        <CorrectionDialog seed={seed} runId={runId} graph={graph} report={report} canCorrect={canCorrect} onClose={() => setSeed(undefined)} />
      )}
    </ReportContext.Provider>
  );
}

function Missing({ title, why }: { title: string; why: string }) {
  return (
    <section className="rounded-lg border border-dashed border-line bg-white/60 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted">{why}</p>
    </section>
  );
}
