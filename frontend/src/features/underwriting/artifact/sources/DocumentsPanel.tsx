import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { documentFileUrl, getApi } from "../../../../api/client";
import { useRuns } from "../../../../api/hooks";
import type { RunSummary, UnderwritingReport } from "../../../../api/types";
import { ErrorBox } from "../../../../components/ui/ErrorBox";
import { Spinner } from "../../../../components/ui/Spinner";
import { DropArea } from "../../chat/DocumentDrop";
import { MAX_DOCUMENTS, formatSize } from "../../chat/documents";
import { useDocuments } from "../../chat/useDocuments";
import { groupRuns } from "../../history";
import { buildDocumentRows, changeNote, lineageDocumentIds, sameSelection, selectionOf, type DocumentRow } from "./documentRows";

interface Props {
  run: RunSummary;
  report: UnderwritingReport | undefined;
  /** the run has finished, so a new version can be made from it */
  canRerun: boolean;
}

function status(row: DocumentRow, report: UnderwritingReport | undefined): string {
  if (!row.inRun) return "Not in this version";
  if (!report) return "Read by this run";
  if (row.evidence === 0) return "Nothing from it reached the evidence";
  const items = `${row.evidence} evidence ${row.evidence === 1 ? "item" : "items"}`;
  return `${items}, cited by ${row.citedBy} ${row.citedBy === 1 ? "claim" : "claims"}`;
}

/** The files the analysis reads, as a list to tick. Changing the ticks makes a new version of the run. */
export function DocumentsPanel(props: Props) {
  // a new run starts from its own ticks
  return <Panel key={props.run.id} {...props} />;
}

function Panel({ run, report, canRerun }: Props) {
  const uid = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runs = useRuns();
  const uploads = useDocuments();
  const [choices, setChoices] = useState<Record<string, boolean>>({});

  const runIds = useMemo(() => run.program.document_ids ?? [], [run]);
  const versions = useMemo(() => groupRuns(runs.data ?? []).find((g) => g.runs.some((r) => r.id === run.id))?.runs ?? [run], [runs.data, run]);
  const lineageIds = useMemo(() => lineageDocumentIds(versions), [versions]);
  const lookups = useQueries({
    queries: lineageIds.map((id) => ({
      queryKey: ["document", id],
      queryFn: async () => (await getApi()).getDocument(id),
      staleTime: Infinity,
      retry: false,
    })),
  });
  const infos = Object.fromEntries(lineageIds.map((id, i) => [id, lookups[i]?.data]));
  const rows = buildDocumentRows({ runIds, lineageIds, uploaded: uploads.documents, choices, infos, report });
  const selection = selectionOf(rows);
  const changed = !sameSelection(selection, runIds);
  const tooMany = selection.length > MAX_DOCUMENTS;

  const rerun = useMutation({
    mutationFn: async () =>
      (await getApi()).createCorrection(run.id, "ingest_user_input", { text: changeNote(rows, runIds), document_ids: selection }),
    onSuccess: (child) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/underwriting/runs/${child.id}`, { state: { panel: "graph" } });
    },
  });

  return (
    <section aria-labelledby={`${uid}-title`} className="border-b border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={`${uid}-title`} className="text-base font-semibold">
          Your documents
        </h2>
        <p className="text-xs text-muted">Tick the files the analysis should read.</p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">This run read no documents of yours. Add a PDF, text or markdown file to give the analysis your own data.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line/70 rounded-md border border-line bg-surface" aria-label="Documents">
          {rows.map((row) => {
            const name = row.info?.name ?? "Loading the name";
            const url = documentFileUrl(row.id);
            return (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  id={`${uid}-${row.id}`}
                  type="checkbox"
                  checked={row.checked}
                  onChange={(e) => setChoices((c) => ({ ...c, [row.id]: e.target.checked }))}
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                <label htmlFor={`${uid}-${row.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block truncate text-sm font-medium" title={name}>
                    {name}
                  </span>
                  <span className="block text-xs text-muted">{status(row, report)}</span>
                </label>
                {row.info && (
                  <span className="shrink-0 text-xs text-muted">
                    {row.info.kind === "pdf" ? "PDF" : "Text"} · {formatSize(row.info.size_bytes)}
                  </span>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    Open
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2">
        <DropArea inputId={`${uid}-add`} onAdd={(files) => void uploads.add(files)} hint="Drop PDF, text or markdown files here to add them." />
        {uploads.uploading.map((name) => (
          <p key={name} role="status" className="mt-1 text-xs text-muted">
            Uploading {name}
          </p>
        ))}
        {uploads.problems.map((p) => (
          <p key={p} role="alert" className="mt-1 text-xs text-red-700">
            {p}
          </p>
        ))}
      </div>

      {changed && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">
            {selection.length === 0 ? "No documents selected." : `${selection.length} ${selection.length === 1 ? "document" : "documents"} selected.`} Re-running makes a new version that
            starts again from the user-input step; the steps before it are reused.
          </p>
          <button
            type="button"
            disabled={!canRerun || tooMany || rerun.isPending}
            onClick={() => rerun.mutate()}
            className="inline-flex items-center gap-2 rounded-full bg-royal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
          >
            {rerun.isPending && <Spinner className="h-3.5 w-3.5" />}
            Re-run with these
          </button>
          {!canRerun && <p className="basis-full text-xs text-muted">The run has to finish first.</p>}
          {tooMany && (
            <p role="alert" className="basis-full text-xs text-red-700">
              A run reads at most {MAX_DOCUMENTS} documents. Clear some.
            </p>
          )}
        </div>
      )}
      {rerun.error && (
        <div className="mt-2">
          <ErrorBox error={rerun.error} title="Could not start the re-run" />
        </div>
      )}
    </section>
  );
}
