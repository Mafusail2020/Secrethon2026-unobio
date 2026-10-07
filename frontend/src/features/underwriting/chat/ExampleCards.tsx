import { EXAMPLES, type Example } from "./examples";

/** Cards fill the composer; they never start a run. */
export function ExampleCards({ onPick }: { onPick: (example: Example) => void }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Try an example</h2>
      <ul className="grid gap-2">
        {EXAMPLES.map((example) => (
          <li key={example.id}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-left transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className="block text-sm font-medium">{example.title}</span>
              <span className="block text-xs text-muted">{example.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
