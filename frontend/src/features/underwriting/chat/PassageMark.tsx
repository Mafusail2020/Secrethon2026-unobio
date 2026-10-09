import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEvidenceDetail } from "../../../api/hooks";
import { PassageQuote } from "./passage";
import { passageLabel } from "./passageLabel";

/** A numbered citation of a passage in the user's own file: the number opens the quote under it. */
export function PassageMark({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const found = useEvidenceDetail(id, open);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const label = found.data ? passageLabel(found.data) : undefined;
  return (
    <span ref={box} className="relative">
      <sup>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Show passage ${children} from your files`}
          onClick={() => setOpen((o) => !o)}
          className="mx-0.5 inline-block rounded bg-slate-200 px-1 text-[0.7rem] font-medium leading-4 text-ink transition-colors hover:bg-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {children}
        </button>
      </sup>
      {open && (
        <span role="dialog" aria-label="Passage from your files" className="uw-fade absolute left-0 top-full z-30 mt-1 block w-80 max-w-[80vw] rounded-sm border border-line bg-surface p-2 text-left font-normal shadow-lg">
          {found.data && label ? (
            <>
              <span className="mb-1 block text-xs font-medium text-muted">
                {label.name}
                {label.where}
              </span>
              <PassageQuote detail={found.data} className="bg-slate-100" />
            </>
          ) : found.isError ? (
            <span className="block text-xs text-red-700">This passage could not be loaded.</span>
          ) : (
            <span className="block text-xs text-muted">Loading the passage…</span>
          )}
        </span>
      )}
    </span>
  );
}
