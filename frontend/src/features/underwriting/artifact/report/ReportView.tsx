import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphSpec, SectionId, UnderwritingReport } from "../../../../api/types";
import { DECISION_LABEL, pct } from "../../../../lib/format";
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
import { buildReportTree, questionOfClaim, type QuestionId } from "./reportTree";
import { RunDetails } from "./RunDetails";
import { Chevron } from "./tree/Chevron";
import { Collapse } from "./tree/Collapse";
import { ReportTreeView } from "./tree/ReportTree";
import { Section } from "./Section";
import { useScrollSpy } from "./useScrollSpy";
import { WhatChanged } from "./WhatChanged";

const SECTION_ORDER: SectionId[] = [
  "disease_need",
  "scientific_thesis",
  "translation",
  "safety",
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
  const tree = useMemo(() => buildReportTree(report), [report]);
  const [openQuestions, setOpenQuestions] = useState<ReadonlySet<QuestionId>>(() => new Set());
  const [fullOpen, setFullOpen] = useState(false);
  const [rootInView, setRootInView] = useState(true);
  // a link to a claim opens the branch it sits in (or the full report, for a claim no question holds); done while rendering,
  // once per link, so the branch is open by the time the page scrolls to the claim
  const [seenLink, setSeenLink] = useState<number | undefined>();
  if (focus && focus.nonce !== seenLink) {
    setSeenLink(focus.nonce);
    const branch = questionOfClaim(tree, focus.id);
    if (branch) setOpenQuestions((open) => new Set(open).add(branch));
    else setFullOpen(true);
  }
  const toggleQuestion = (id: QuestionId) =>
    setOpenQuestions((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const focusInAll = !!focus && !questionOfClaim(tree, focus.id);

  const sections = SECTION_ORDER.flatMap((id) => (report.sections[id] ? [report.sections[id]] : []));
  const nav = [
    // once the call has scrolled away this chip keeps it in sight; it only changes width, never the header's height
    { id: "summary", label: rootInView ? "Summary" : `${DECISION_LABEL[verdict.decision]} · ${pct(report.pos.base)}` },
    ...tree.questions.map((q) => ({ id: `q-${q.id}`, label: q.short })),
    { id: "full-report", label: "Full report" },
  ];
  const header = useRef<HTMLElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const { active, select } = useScrollSpy(nav.map((n) => n.id).join("|"), header);

  // anchors scroll to just under the sticky header, whatever height its rows wrap to
  useLayoutEffect(() => {
    const bar = header.current;
    const box = wrapper.current;
    if (!bar || !box || typeof ResizeObserver === "undefined") return;
    const apply = () => box.style.setProperty("--report-header", `${bar.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const jumpToClaim = (id: string) => {
    setFilters(emptyFilters);
    setLocal((prev) => ({ id, nonce: Math.max(prev?.nonce ?? 0, focusClaim?.nonce ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!focus) return;
    // a branch that was closed needs its opening to finish before the claim is where it will stay
    const timer = window.setTimeout(
      () => {
        const el =
          document.getElementById(`tree-claim-${focus.id}`) ?? document.getElementById(`claim-${focus.id}`) ?? document.getElementById(`all-claim-${focus.id}`);
        el?.scrollIntoView({ block: "center", behavior: prefersCalm() ? "auto" : "smooth" });
      },
      prefersCalm() ? 0 : 420,
    );
    return () => window.clearTimeout(timer);
  }, [focus]);

  useEffect(() => {
    const call = document.getElementById("summary-call");
    const bar = header.current;
    if (!call || !bar || typeof IntersectionObserver === "undefined") return;
    // the page scrolls inside the dock, not the window: watch it from there, minus the sticky header laid over its top
    let scroller: HTMLElement | null = call.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== "visible")) scroller = scroller.parentElement;
    // half hidden counts as gone: a sliver of the number peeking out under the header is no longer the call on screen
    const watcher = new IntersectionObserver(([entry]) => setRootInView(!!entry && entry.intersectionRatio >= 0.5), {
      root: scroller,
      rootMargin: `-${bar.offsetHeight}px 0px 0px 0px`,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    watcher.observe(call);
    return () => watcher.disconnect();
  }, []);

  // print rules in styles/print.css apply only while a report is on screen
  useEffect(() => {
    document.body.dataset.print = "report";
    return () => {
      delete document.body.dataset.print;
    };
  }, []);

  return (
    <ReportContext.Provider value={{ report, runId, graph, canCorrect, focus, jumpToClaim, openCorrection: setSeed }}>
      <div ref={wrapper} className="@container pb-6">
        <header ref={header} className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur" data-print-header>
          <div className="flex items-center gap-3 px-4 py-2">
            <nav aria-label="Report sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-print-hide>
              {nav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    scrollToId(item.id);
                    select(item.id);
                  }}
                  aria-current={active === item.id ? "location" : undefined}
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                    active === item.id ? "bg-navy text-white" : "text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <ExportBar report={report} />
          </div>
        </header>

        <div className="space-y-4 p-4">
          {report.meta.parent_run_id && <WhatChanged report={report} onJumpSection={(id) => scrollToId(`section-${id}`)} />}

          <ReportTreeView
            report={report}
            tree={tree}
            open={openQuestions}
            onToggle={toggleQuestion}
            onSetAll={(all) => setOpenQuestions(all ? new Set(tree.questions.map((q) => q.id)) : new Set())}
            onJump={(id) => {
              setOpenQuestions((open) => new Set(open).add(id));
              scrollToId(`q-${id}`);
            }}
            focus={focus}
          />

          <section id="full-report" aria-labelledby="full-report-title" className="report-anchor rounded-sm border border-line bg-surface">
            <button
              type="button"
              aria-expanded={fullOpen}
              aria-controls="full-report-body"
              onClick={() => setFullOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-3 rounded-sm p-4 text-left hover:bg-canvas/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              data-print-hide
            >
              <span>
                <span id="full-report-title" className="block text-xl font-semibold tracking-tight">
                  Full report
                </span>
                <span className="block text-sm text-muted">Every section, chart and claim ({claims.length}), and how the run went</span>
              </span>
              <Chevron open={fullOpen} />
            </button>
            <Collapse open={fullOpen} id="full-report-body">
              <div className="space-y-4 border-t border-line p-4">
                <section id="overview" className="report-anchor space-y-4" aria-label="Overview">
                  <div className="grid gap-4 @3xl:grid-cols-2">
                    {report.twin_stats ? <TwinPanel twin={report.twin_stats} report={report} /> : <Missing title="Similar programs" why="Historical twin statistics are not available for this run." />}
                    {report.valuation ? <ValuationPanel valuation={report.valuation} /> : <Missing title="Funding to the next milestone" why="No valuation was produced for this run." />}
                  </div>
                  {report.ledger ? <LedgerWaterfall ledger={report.ledger} /> : <Missing title="Evidence ledger" why="No evidence ledger was produced, so the probability above rests on the twin prior alone." />}
                </section>

                {report.translation_chain.length > 0 && (
                  <div id="translation-chain" className="report-anchor">
                    <TranslationStepper chain={report.translation_chain} />
                  </div>
                )}

                {sections.map((s) => (
                  <Section key={s.section} result={s} />
                ))}

                <div id="risks-unknowns" className="report-anchor space-y-4">
                  {report.key_risks.length > 0 && <RisksPanel risks={report.key_risks} />}
                  {(report.critical_unknowns.length > 0 || report.diligence_questions.length > 0) && (
                    <DiligencePanel unknowns={report.critical_unknowns} questions={report.diligence_questions} />
                  )}
                </div>

                <details key={focusInAll ? focus.nonce : "all"} id="all-claims" open={focusInAll || undefined} className="report-anchor rounded-sm border border-line bg-surface p-3">
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

                <div id="run-details" className="report-anchor">
                  <RunDetails meta={report.meta} runId={report.run_id} />
                </div>
              </div>
            </Collapse>
          </section>
          {/* room to scroll the last card up to the header, so a chip always lands where it points */}
          <div aria-hidden="true" className="h-[45vh]" data-print-hide />
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
    <section className="rounded-sm border border-dashed border-line bg-surface/60 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted">{why}</p>
    </section>
  );
}
