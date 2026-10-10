import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useRunDetail } from "../../../../../api/hooks";
import { ErrorBox } from "../../../../../components/ui/ErrorBox";
import { Spinner } from "../../../../../components/ui/Spinner";
import { SYNTHETIC_WARNING } from "../deck/SlideFrame";
import { NoteBody } from "./NoteBody";
import { buildNote } from "./noteDoc";

const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The report as one note: properties, an outline beside it, headings of different sizes, quotes under each claim. */
export default function NotePage() {
  const { runId } = useParams();
  const detail = useRunDetail(runId);
  const report = detail.data?.report ?? undefined;
  const note = useMemo(() => (report ? buildNote(report) : undefined), [report]);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [flash, setFlash] = useState<string | undefined>();
  const timer = useRef<number | undefined>(undefined);
  const back = `/underwriting/runs/${runId ?? ""}`;

  useEffect(() => {
    if (!report) return;
    const before = document.title;
    document.title = `${report.program.mechanism} in ${report.program.indication}: note`;
    return () => {
      document.title = before;
    };
  }, [report]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    setFlash(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(undefined), 1600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note!.markdown);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-white text-ink">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-canvas px-4 py-2">
        <Link to={back} className="rounded-sm text-sm font-medium text-royal hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          ← Back to the report
        </Link>
        <h1 className="text-sm font-semibold">Note</h1>
        <button
          type="button"
          disabled={!note}
          onClick={() => void copy()}
          className="ml-auto rounded-sm border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
        >
          {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy Markdown"}
        </button>
      </header>

      {detail.isPending && (
        <p className="flex items-center gap-2 p-8 text-sm text-muted" role="status">
          <Spinner /> Loading the report…
        </p>
      )}
      {detail.isError && (
        <div className="p-8">
          <ErrorBox error={detail.error} />
        </div>
      )}
      {detail.data && !report && <p className="p-8 text-sm text-muted">This run has no report yet, so there is no note to show.</p>}

      {note && (
        <div className="flex min-h-0 flex-1 justify-center overflow-auto">
          <main className="min-w-0 max-w-[760px] flex-1 px-8 pb-24 pt-10 text-[1rem] leading-[1.6]" aria-label="Note">
            {note.synthetic && (
              <p role="note" className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                <strong className="font-semibold">Synthetic data.</strong> {SYNTHETIC_WARNING.replace("deck", "note")}
              </p>
            )}
            <section aria-label="Properties" className="mb-6 rounded-md border border-line bg-slate-50/70 px-4 py-3 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Properties</p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                {note.properties.map((p) => (
                  <div key={p.key} className="contents">
                    <dt className="text-muted">{p.key}</dt>
                    <dd>{p.value}</dd>
                  </div>
                ))}
                <dt className="text-muted">tags</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {note.tags.map((t) => (
                    <span key={t} className="rounded-full bg-violet-100 px-2 text-violet-800">
                      {t}
                    </span>
                  ))}
                </dd>
              </dl>
            </section>

            <NoteBody markdown={note.markdown} onJump={jump} />

            {note.sources.length > 0 && (
              <section aria-labelledby="sources">
                <h2 id="sources" className="mb-2 mt-9 scroll-mt-6 text-[1.6em] font-bold leading-tight tracking-tight">
                  Sources
                </h2>
                <ol className="space-y-1.5 text-[0.95em]">
                  {note.sources.map((s) => (
                    <li key={s.n} id={`src-${s.n}`} className={`flex gap-2 rounded px-1.5 py-0.5 transition-colors duration-500 ${flash === `src-${s.n}` ? "bg-violet-100" : ""}`}>
                      <span className="w-6 shrink-0 text-right text-muted">{s.n}.</span>
                      <span>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600">
                            {s.title}
                          </a>
                        ) : (
                          s.title
                        )}
                        <span className="block text-[0.9em] text-muted">{s.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </main>
          <aside aria-label="Outline" className="sticky top-0 hidden w-60 shrink-0 self-start py-10 pr-6 text-sm xl:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Outline</p>
            <ul className="space-y-1 border-l border-line pl-3">
              {note.outline.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      jump(h.id);
                    }}
                    className="block rounded px-1 py-0.5 text-muted hover:bg-slate-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
