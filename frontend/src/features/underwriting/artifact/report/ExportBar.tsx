import { useState } from "react";
import { traceUrl } from "../../../../api/client";
import type { UnderwritingReport } from "../../../../api/types";
import { toMarkdown } from "./markdown";

const button =
  "rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

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
    <div className="flex flex-wrap items-center gap-1.5" data-print-hide>
      <button type="button" onClick={copy} className={button}>
        {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy as Markdown"}
      </button>
      {download && (
        <a href={download} download className={button}>
          Download trace
        </a>
      )}
      <button type="button" onClick={() => window.print()} className={button}>
        Print
      </button>
      <span role="status" className="sr-only">
        {copied === "ok" ? "Report copied to the clipboard" : ""}
      </span>
    </div>
  );
}
