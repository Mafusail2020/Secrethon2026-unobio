import { Composer } from "./Composer";

/** The new-chat screen: a short greeting and the big composer. */
export function Welcome() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10">
      <div className="uw-rise mb-8 text-center">
        {/* inline: the unlayered h2 rule in tokens.css beats a font-serif utility */}
        <h2 className="text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl" style={{ fontFamily: "var(--font-serif)" }}>
          Underwrite a <em className="text-royal">drug program</em>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
          Tell me about your drug program. I research public evidence and tell you whether funding it to the next milestone
          is worth it, with every claim traceable to its sources.
        </p>
      </div>
      <div className="uw-rise" style={{ animationDelay: "90ms" }}>
        <Composer />
      </div>
    </div>
  );
}
