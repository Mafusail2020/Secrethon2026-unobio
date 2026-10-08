import { useRef, type KeyboardEvent } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

/** Tab list with the keyboard behaviour from the ARIA pattern: one tab stop, arrows/Home/End move and select. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  idPrefix,
  label,
  variant = "underline",
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  /** pairs with role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-${active}`} */
  idPrefix: string;
  label: string;
  variant?: "underline" | "pill";
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === active);
    const next =
      event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : -1; // fmt: skip
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next]!;
    onChange(target.id);
    refs.current[target.id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={variant === "underline" ? "flex gap-1 border-b border-line bg-surface px-3" : "mt-2 flex gap-1"}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            id={`${idPrefix}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={
              variant === "underline"
                ? `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${selected ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`
                : `rounded-full px-2.5 py-0.5 text-xs ${selected ? "bg-navy text-white" : "text-muted hover:bg-canvas"}`
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
