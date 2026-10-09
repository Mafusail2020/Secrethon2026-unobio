import { useId, useRef, useState, type DragEvent } from "react";
import type { DocumentInfo } from "../../../api/types";
import { DOCUMENT_ACCEPT, MAX_DOCUMENTS, formatSize } from "./documents";

interface Props {
  documents: DocumentInfo[];
  uploading: string[];
  problems: string[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}

/** Files the analysis should read as the program's own data, e.g. a preclinical report. */
export function DocumentDrop({ documents, uploading, problems, onAdd, onRemove }: Props) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    onAdd([...event.dataTransfer.files]);
  };

  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-muted" htmlFor={uid}>
        Documents
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors ${
          over ? "border-brand bg-brand/10" : "border-line bg-surface"
        }`}
      >
        <span className="text-muted">Drop PDF, text or markdown files here (up to {MAX_DOCUMENTS}, 10 MB each). They count as your own data.</span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Choose files
        </button>
        <input
          ref={input}
          id={uid}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            onAdd([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {(documents.length > 0 || uploading.length > 0) && (
        <ul className="mt-1.5 space-y-1" aria-label="Attached documents">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md bg-slate-100 px-2.5 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate" title={d.name}>
                {d.name}
              </span>
              <span className="shrink-0 text-xs text-muted">{formatSize(d.size_bytes)}</span>
              <button
                type="button"
                onClick={() => onRemove(d.id)}
                aria-label={`Remove ${d.name}`}
                className="shrink-0 rounded-full px-1.5 text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                ×
              </button>
            </li>
          ))}
          {uploading.map((name) => (
            <li key={name} role="status" className="flex items-center gap-2 rounded-md bg-slate-100/60 px-2.5 py-1 text-sm text-muted">
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="text-xs">Uploading</span>
            </li>
          ))}
        </ul>
      )}
      {problems.map((p) => (
        <p key={p} role="alert" className="mt-1 text-xs text-red-700">
          {p}
        </p>
      ))}
    </div>
  );
}
