import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { reportPdfUrl, traceUrl } from "../../../../api/client";
import type { UnderwritingReport } from "../../../../api/types";
import { toMarkdown } from "./markdown";

const item =
  "block w-full rounded-sm px-3 py-2 text-left hover:bg-canvas focus-visible:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

function Entry({ title, note }: { title: string; note: string }) {
  return (
    <>
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted">{note}</span>
    </>
  );
}

/** The one place to turn the report into something to hand over: the committee deck, the full report, or its raw parts. */
export function ExportBar({ report }: { report: UnderwritingReport }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const download = traceUrl(report.run_id);
  const pdf = reportPdfUrl(report.run_id);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const copy = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(toMarkdown(report));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  return (
    <div ref={root} className="relative shrink-0" data-print-hide>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-sm bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-royal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Generate report"}
        <svg viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M2 4.5 6 8.5l4-4" />
        </svg>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Generate report" className="uw-fade absolute right-0 top-full z-30 mt-2 w-72 rounded-sm border border-line bg-surface p-1 shadow-lg">
          <Link role="menuitem" to={`/underwriting/runs/${report.run_id}/deck`} className={item} onClick={() => setOpen(false)} autoFocus>
            <Entry title="Investment committee deck" note="Landscape slides to present, saved as a PDF" />
          </Link>
          {pdf ? (
            // a real file from the backend: nothing depends on the browser's print dialog
            <a role="menuitem" href={pdf} download className={item} onClick={() => setOpen(false)}>
              <Entry title="Full report (PDF)" note="Downloads the report with every claim, quote and source" />
            </a>
          ) : (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                window.print();
              }}
            >
              <Entry title="Full report (PDF)" note="Every claim and source, as it prints" />
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={copy}>
            <Entry title="Copy as Markdown" note="To paste into a document or an email" />
          </button>
          {download && (
            <a role="menuitem" href={download} download className={item} onClick={() => setOpen(false)}>
              <Entry title="Download the trace" note="Every step, prompt and cost of this run" />
            </a>
          )}
        </div>
      )}
      <span role="status" className="sr-only">
        {copied === "ok" ? "Report copied to the clipboard" : ""}
      </span>
    </div>
  );
}
