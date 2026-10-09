import type { EvidenceDetail } from "../../../api/types";
import { documentFileUrl } from "../../../api/client";

const QUOTE_MAX = 700;

/** The passage itself, as it stands in the file, with a way to open the file. */
export function PassageQuote({ detail, className = "" }: { detail: EvidenceDetail; className?: string }) {
  const documentId = detail.source.identifiers.document;
  const file = documentId ? documentFileUrl(documentId) : null;
  const text = detail.evidence.excerpt;
  return (
    <blockquote className={`rounded-sm border-l-4 border-brand bg-slate-100 px-3 py-2 text-sm leading-relaxed ${className}`}>
      <p className="whitespace-pre-wrap">{text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX)} …` : text}</p>
      {file && (
        <a href={file} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand hover:underline">
          Open the file
        </a>
      )}
    </blockquote>
  );
}
