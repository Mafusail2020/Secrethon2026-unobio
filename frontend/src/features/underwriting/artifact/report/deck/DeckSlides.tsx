import type { Deck, DeckSlide } from "./deckModel";
import { EvidenceBody, FundingBody, ProbabilityBody, RisksBody, TwinsBody } from "./NumberSlides";
import { CallBody, QuestionBody, RecommendationBody, TitleSlideView } from "./ProgramSlides";
import { SlideFrame, SLIDE_H, SLIDE_W } from "./SlideFrame";

function Body({ slide }: { slide: DeckSlide }) {
  switch (slide.kind) {
    case "call":
      return <CallBody slide={slide} />;
    case "question":
      return <QuestionBody slide={slide} />;
    case "probability":
      return <ProbabilityBody slide={slide} />;
    case "twins":
      return <TwinsBody slide={slide} />;
    case "funding":
      return <FundingBody slide={slide} />;
    case "evidence":
      return <EvidenceBody slide={slide} />;
    case "risks":
      return <RisksBody slide={slide} />;
    case "recommendation":
      return <RecommendationBody slide={slide} />;
    case "title":
      return null;
  }
}

/** Each slide sits in a box of its scaled size; paper ignores the scale, so a page is always the full slide. */
function Scaled({ scale, children }: { scale: number; children: React.ReactNode }) {
  return (
    <div className="deck-frame shrink-0 shadow-md" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
      <div className="deck-scale origin-top-left" style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

export function DeckSlides({ deck, kicker, scale = 1 }: { deck: Deck; kicker: string; scale?: number }) {
  const total = deck.slides.length;
  return (
    <>
      {deck.slides.map((slide, i) => (
        <Scaled key={slide.id} scale={scale}>
          {slide.kind === "title" ? (
            <TitleSlideView slide={slide} index={i + 1} total={total} synthetic={deck.synthetic} />
          ) : (
            <SlideFrame title={slide.title} kicker={kicker} index={i + 1} total={total} sources={slide.sources} synthetic={deck.synthetic}>
              <Body slide={slide} />
            </SlideFrame>
          )}
        </Scaled>
      ))}
    </>
  );
}
