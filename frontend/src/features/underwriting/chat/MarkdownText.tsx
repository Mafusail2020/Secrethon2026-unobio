import { createContext, useContext, useMemo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UnderwritingReport } from "../../../api/types";
import { withCitationLinks } from "./citations";
import { PassageMark } from "./PassageMark";

const urlTransform = (url: string) => (url.startsWith("claim:") || url.startsWith("passage:") ? url : defaultUrlTransform(url));

const ClaimContext = createContext<{ report: UnderwritingReport | undefined; onOpenClaim: (claimId: string) => void }>({
  report: undefined,
  onOpenClaim: () => {},
});

function Anchor({ href, children }: ComponentPropsWithoutRef<"a">) {
  const { report, onOpenClaim } = useContext(ClaimContext);
  // sup has line-height 0 in the reset; the button needs its own or it has no height to click
  if (href?.startsWith("claim:")) {
    const id = href.slice("claim:".length);
    const claim = report?.claims[id];
    return (
      <sup>
        <button
          type="button"
          onClick={() => onOpenClaim(id)}
          title={claim?.text}
          aria-label={`Open claim ${children}${claim ? `: ${claim.text}` : ""}`}
          className="mx-0.5 inline-block rounded bg-brand/10 px-1 transition-colors text-[0.7rem] font-medium leading-4 text-brand hover:bg-brand/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {children}
        </button>
      </sup>
    );
  }
  if (href?.startsWith("passage:")) return <PassageMark id={href.slice("passage:".length)}>{children}</PassageMark>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-brand underline">
      {children}
    </a>
  );
}

// Two sets of components for the whole app, never rebuilt: react-markdown draws elements with whatever components it is
// given, and a new function for `p` or `h2` on every render makes React throw the old text away and mount it again, which
// replays its entrance animation. Dragging the dock re-renders the thread dozens of times a second, so the text vanished.
// `briefing` is a document (headings, a bar on each section, room to breathe); `answer` is a chat reply (tight, no bars).
function build(kind: "briefing" | "answer"): Components {
  const doc = kind === "briefing";
  return {
    h1: ({ children }) => <h2 className={doc ? H2 : H2_ANSWER}>{children}</h2>,
    h2: ({ children }) => <h2 className={doc ? H2 : H2_ANSWER}>{children}</h2>,
    h3: ({ children }) => <h3 className={doc ? H3 : H3_ANSWER}>{children}</h3>,
    h4: ({ children }) => <h4 className={H3_ANSWER}>{children}</h4>,
    p: ({ children }) => <p className={doc ? "my-2.5" : "my-1.5"}>{children}</p>,
    ul: ({ children }) => <ul className={`${doc ? "my-2.5 space-y-1.5" : "my-1.5 space-y-1"} list-disc pl-5 marker:text-brand/60`}>{children}</ul>,
    ol: ({ children }) => <ol className={`${doc ? "my-2.5 space-y-1.5" : "my-1.5 space-y-1"} list-decimal pl-5 marker:font-medium marker:text-muted`}>{children}</ol>,
    li: ({ children, className }) => (
      // a task-list item keeps its checkbox and drops the bullet
      <li className={`pl-0.5 ${className?.includes("task-list-item") ? "list-none -ml-5" : ""}`}>{children}</li>
    ),
    input: ({ type, checked }) =>
      type === "checkbox" ? <input type="checkbox" checked={!!checked} disabled readOnly className="mr-1.5 translate-y-px accent-brand" /> : null,
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="text-muted">{children}</del>,
    code: ({ children }) => <code className="rounded-sm bg-slate-100 px-1 py-px font-mono text-[0.85em] text-slate-800">{children}</code>,
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-sm bg-slate-900 p-3 text-xs leading-relaxed text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 rounded-sm border-l-4 border-brand/40 bg-slate-50 px-3 py-1 text-muted [&>p]:my-1">{children}</blockquote>
    ),
    hr: () => <hr className="my-5 border-line" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
    th: ({ children }) => <th className="border-b border-line px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">{children}</th>,
    td: ({ children }) => <td className="border-b border-line/60 px-3 py-1.5 align-top">{children}</td>,
    tr: ({ children }) => <tr className="even:bg-slate-50/60">{children}</tr>,
    a: Anchor,
  };
}

const H2 = "mb-2 mt-7 border-l-4 border-brand pl-2.5 text-[1.05rem] font-semibold leading-snug tracking-tight text-ink first:mt-0";
const H3 = "mb-1 mt-4 text-[0.72rem] font-semibold uppercase tracking-wider text-muted";
const H2_ANSWER = "mb-1 mt-3 text-sm font-semibold text-ink first:mt-0";
const H3_ANSWER = "mb-0.5 mt-2 text-sm font-medium text-ink first:mt-0";

const BRIEFING = build("briefing");
const ANSWER = build("answer");

/** Markdown the model wrote, drawn with the workspace's own styles. Raw HTML is never rendered. */
export function MarkdownText({
  text,
  ids,
  passageIds = [],
  variant = "briefing",
  report,
  onOpenClaim,
}: {
  text: string;
  ids: string[];
  /** passages of the user's files the text cites; numbered together with the claims */
  passageIds?: string[];
  /** a long briefing, or a short chat reply */
  variant?: "briefing" | "answer";
  report: UnderwritingReport | undefined;
  onOpenClaim: (claimId: string) => void;
}) {
  const claims = useMemo(() => ({ report, onOpenClaim }), [report, onOpenClaim]);
  return (
    <ClaimContext.Provider value={claims}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={variant === "answer" ? ANSWER : BRIEFING}>
        {withCitationLinks(text, ids, passageIds)}
      </ReactMarkdown>
    </ClaimContext.Provider>
  );
}
