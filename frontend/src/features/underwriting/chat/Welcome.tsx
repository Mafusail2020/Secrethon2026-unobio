import { useState } from "react";
import { SparkIcon } from "../../../components/ui/icons";
import { Composer } from "./Composer";
import { ExampleCards } from "./ExampleCards";

interface Prefill {
  indication: string;
  mechanism: string;
  nonce: number;
}

/** The new-chat screen: a short greeting, the big composer, and a few examples to start from. */
export function Welcome() {
  const [prefill, setPrefill] = useState<Prefill | undefined>();
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <SparkIcon width={40} height={40} className="mx-auto text-royal" />
        {/* inline: the unlayered h2 rule in tokens.css beats a font-serif utility */}
        <h2 className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl" style={{ fontFamily: "var(--font-serif)" }}>
          Underwrite a <em className="text-royal">drug program</em>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
          Tell me about a drug program. I research public evidence and tell you whether funding it to the next milestone
          is worth it, with every claim traceable to its sources.
        </p>
      </div>
      <Composer key={prefill?.nonce ?? 0} initial={prefill} />
      <div className="mt-5">
        <ExampleCards
          onPick={(e) => setPrefill((p) => ({ indication: e.indication, mechanism: e.mechanism, nonce: (p?.nonce ?? 0) + 1 }))}
        />
      </div>
    </div>
  );
}
