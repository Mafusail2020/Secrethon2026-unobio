import { useId } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

/** Radio group drawn as a segmented control; the selected option's hint shows underneath. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  const selected = options.find((o) => o.value === value);
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-muted">{label}</legend>
      <div className="grid grid-flow-col auto-cols-fr rounded-full border border-line bg-canvas p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={`cursor-pointer rounded-full px-2 py-1 text-center text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
              option.value === value ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {selected && <p className="mt-1 text-xs text-muted">{selected.hint}</p>}
    </fieldset>
  );
}
