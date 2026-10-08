import { useState } from "react";
import { traceUrl } from "../../../../api/client";
import type { UnderwritingReport } from "../../../../api/types";
import { toMarkdown } from "./markdown";

const button =
  "shrink-0 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

export function ExportBar({ report }: { report: UnderwritingReport }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const download = traceUrl(report.run_id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(report));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5" data-print-hide>
      <button type="button" onClick={copy} className={button} title="Copy the report as Markdown" aria-label="Copy the report as Markdown">
        {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
      </button>
      {download && (
        <a href={download} download className={button} title="Download the run's trace" aria-label="Download the run's trace">
          Trace
        </a>
      )}
      <button type="button" onClick={() => window.print()} className={button} title="Print the report" aria-label="Print the report">
        Print
      </button>
      <span role="status" className="sr-only">
        {copied === "ok" ? "Report copied to the clipboard" : ""}
      </span>
    </div>
  );
}
