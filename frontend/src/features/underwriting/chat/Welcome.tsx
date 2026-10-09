import { Composer } from "./Composer";
import { useTypewriter } from "./useTypewriter";

const LEAD = "Underwrite a ";
const EMPHASIS = "drug program";
const INTRO =
  "Tell me about your drug program. I research public evidence and tell you whether funding it to the next milestone is worth it, with every claim traceable to its sources.";

const PARTS = [
  { text: LEAD, speed: 55 },
  { text: EMPHASIS, speed: 55 },
  { text: INTRO, speed: 13 },
];

/** Text that types itself out. The whole text is laid out from the start, so nothing moves while it appears. */
function Typed({ text, count, caret }: { text: string; count: number; caret: boolean }) {
  return (
    <span aria-hidden="true">
      {text.slice(0, count)}
      {caret && <span className="uw-caret" />}
      <span className="invisible">{text.slice(count)}</span>
    </span>
  );
}

/** The new-chat screen: a short greeting, typed out as the page opens, and the big composer. */
export function Welcome() {
  const { counts, done } = useTypewriter(PARTS);
  // the caret sits where the typing is: after the last part that has started and is not yet complete
  const at = counts.findIndex((n, i) => n < PARTS[i]!.text.length);
  const caretAt = done ? -1 : Math.max(at, 0);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-10 pt-[max(2.5rem,18vh)]">
      <div className="mb-8 text-center">
        {/* inline: the unlayered h2 rule in tokens.css beats a font-serif utility */}
        <h2 className="text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl" style={{ fontFamily: "var(--font-serif)" }}>
          <span className="sr-only">
            {LEAD}
            {EMPHASIS}
          </span>
          <Typed text={LEAD} count={counts[0]!} caret={caretAt === 0} />
          <em className="text-royal">
            <Typed text={EMPHASIS} count={counts[1]!} caret={caretAt === 1} />
          </em>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
          <span className="sr-only">{INTRO}</span>
          <Typed text={INTRO} count={counts[2]!} caret={caretAt === 2} />
        </p>
      </div>
      <div className="uw-rise" style={{ animationDelay: "90ms" }}>
        <Composer />
      </div>
    </div>
  );
}
