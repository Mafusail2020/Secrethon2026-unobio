import { DECISION_STYLE, months, pct, usd, usdRange } from "../../../../../lib/format";
import { STANDING_STYLE } from "../tree/treeStyles";
import { Figure, Pill, Reading, Statements } from "./DeckBits";
import type { CallSlide, QuestionSlide, RecommendationSlide, TitleSlide } from "./deckModel";
import { SLIDE_H, SLIDE_W, SYNTHETIC_WARNING } from "./SlideFrame";

export function TitleSlideView({ slide, index, total, synthetic }: { slide: TitleSlide; index: number; total: number; synthetic: boolean }) {
  return (
    <section
      aria-label={`Slide ${index} of ${total}: ${slide.title}`}
      className="deck-slide relative flex flex-col justify-between overflow-hidden bg-navy px-20 py-16 text-white"
      style={{ width: SLIDE_W, height: SLIDE_H }}
    >
      <p className="text-[15px] font-medium uppercase tracking-[0.18em] text-slate-300">Unobio · Drug program underwriting</p>
      <div>
        <p className="text-[18px] text-slate-300">Investment committee</p>
        <h1 className="mt-3 max-w-[980px] font-serif text-[68px] leading-[1.05] tracking-tight">{slide.program}</h1>
        {slide.subtitle && <p className="mt-5 max-w-[960px] text-[26px] leading-snug text-slate-100">{slide.subtitle}</p>}
        {slide.facts.length > 0 && <p className={`text-[22px] text-slate-200 ${slide.subtitle ? "mt-4" : "mt-6"}`}>{slide.facts.join(" · ")}</p>}
      </div>
      <div className="flex items-end justify-between gap-8 text-[15px] text-slate-300">
        <span>{slide.date}</span>
        {synthetic && <span className="max-w-[640px] rounded-sm border border-red-300/60 bg-red-950/50 px-4 py-2 text-[14px] font-medium text-red-100">{SYNTHETIC_WARNING}</span>}
      </div>
    </section>
  );
}

export function CallBody({ slide }: { slide: CallSlide }) {
  return (
    <div className="grid h-full grid-cols-[360px_1fr] gap-10">
      <div className="flex flex-col gap-6">
        <div>
          <Pill className={`px-4 py-1 text-[20px] ${DECISION_STYLE[slide.decision]}`}>{slide.decisionLabel}</Pill>
          <p className="mt-2 text-[14px] text-muted">{slide.confidence} confidence</p>
        </div>
        <Figure label="Probability of success" value={pct(slide.pos.base)} note={`range ${pct(slide.pos.low)} to ${pct(slide.pos.high)}`} />
        {slide.rnpv && <Figure label="Risk-adjusted value" value={usd(slide.rnpv.base)} note={`range ${usd(slide.rnpv.low)} to ${usd(slide.rnpv.high)}`} />}
        {slide.capital && slide.months && (
          <p className="text-[15px] leading-snug text-muted">
            Needs {usdRange(slide.capital)} over {months(slide.months)} to reach the next milestone.
          </p>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <p className="text-[18px] leading-snug">{slide.rationale}</p>
        <div className="grid grid-cols-2 gap-4">
          <Statements side="for" title="What carries it" lines={slide.carries} empty="None the verdict leaned on." />
          <Statements side="against" title="What holds it back" lines={slide.holds} empty="None the verdict leaned on." />
        </div>
      </div>
    </div>
  );
}

export function QuestionBody({ slide }: { slide: QuestionSlide }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start gap-4">
        <Pill className={`mt-1 shrink-0 ${STANDING_STYLE[slide.standing]}`}>{slide.standingLabel}</Pill>
        <div>
          <p className="text-[20px] leading-snug">{slide.headline}</p>
          <p className="mt-1 text-[14px] text-muted">
            {slide.ask} Standing: {slide.basis}.
            {slide.impactPts !== null && ` The evidence moved the chance by ${slide.impactPts > 0 ? "+" : ""}${slide.impactPts.toFixed(1)} points.`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Statements side="for" title="For" lines={slide.pros} empty="No claim for it." />
        <Statements side="against" title="Against" lines={slide.cons} empty="No claim against it." />
      </div>
      {slide.unknowns.length > 0 && (
        <p className="text-[14px] leading-snug text-muted">
          <span className="font-medium text-ink">Not established: </span>
          {slide.unknowns.join("; ")}.
        </p>
      )}
    </div>
  );
}

export function RecommendationBody({ slide }: { slide: RecommendationSlide }) {
  return (
    <div className="grid h-full grid-cols-[360px_1fr] gap-10">
      <div className="flex flex-col gap-5">
        <div>
          <Pill className={`px-5 py-1.5 text-[26px] ${DECISION_STYLE[slide.decision]}`}>{slide.decisionLabel}</Pill>
          <p className="mt-2 text-[14px] text-muted">{slide.confidence} confidence</p>
        </div>
        <Figure label="Probability of success" value={pct(slide.pos.base)} note={`range ${pct(slide.pos.low)} to ${pct(slide.pos.high)}`} />
        <p className="mt-auto text-[12px] text-muted">{slide.footnote}</p>
      </div>
      <div className="flex min-h-0 flex-col gap-5">
        {slide.reading?.length ? <Reading lines={slide.reading} /> : <p className="text-[24px] leading-snug">{slide.rationale}</p>}
        {slide.conditions.length > 0 && (
          <div className="rounded-sm border border-line border-l-[6px] border-l-brand bg-surface/70 px-5 py-4">
            <h3 className="text-[18px] font-semibold">To proceed</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-6 text-[19px] leading-snug">
              {slide.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {slide.questions.length > 0 && (
          <div>
            <h3 className="text-[18px] font-semibold">Ask before committing</h3>
            <ol className="mt-2 list-decimal space-y-2 pl-6 text-[17px] leading-snug">
              {/* a takeaway bar takes the room of the last question */}
              {(slide.takeaway ? slide.questions.slice(0, 3) : slide.questions).map((q) => (
                <li key={q.question}>
                  {q.question}
                  <span className="block text-[13px] text-muted">{q.why}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
