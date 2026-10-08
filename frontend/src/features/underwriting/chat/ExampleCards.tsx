import { EXAMPLES, type Example } from "./examples";

/** Suggestion pills under the composer; they fill it and never start a run. */
export function ExampleCards({ onPick }: { onPick: (example: Example) => void }) {
  return (
    <section aria-label="Try an example">
      <ul className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((example) => (
          <li key={example.id}>
            <button
              type="button"
              onClick={() => onPick(example)}
              title={example.hint}
              className="rounded-full border border-line bg-surface/70 px-4 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              {example.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
