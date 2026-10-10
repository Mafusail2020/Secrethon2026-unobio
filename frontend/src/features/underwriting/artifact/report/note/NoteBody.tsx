import { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { slug } from "./noteDoc";

const JumpContext = createContext<(id: string) => void>(() => {});

const text = (node: unknown): string => (typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : "");

function Anchor({ href, children }: ComponentPropsWithoutRef<"a">) {
  const jump = useContext(JumpContext);
  if (href?.startsWith("#src-")) {
    // a citation: Obsidian draws a footnote reference as a small raised link, and so does this
    return (
      <sup className="mx-px">
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            jump(href.slice(1));
          }}
          className="rounded px-0.5 text-[0.7rem] font-medium text-violet-700 no-underline hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600"
        >
          {children}
        </a>
      </sup>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600">
      {children}
    </a>
  );
}

// Built once, never per render (see MarkdownText): new component functions would make React mount the text again.
// Sizes and weights follow Obsidian's reading view: 2, 1.6, 1.37, 1.25 and 1.12 times the body text.
const components: Components = {
  h1: ({ children }) => <h1 className="mb-4 mt-2 text-[2em] font-bold leading-tight tracking-tight">{children}</h1>,
  h2: ({ children }) => (
    <h2 id={slug(text(children))} className="mb-2 mt-9 scroll-mt-6 text-[1.6em] font-bold leading-tight tracking-tight">
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 className="mb-1.5 mt-6 text-[1.37em] font-semibold leading-snug">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-5 text-[1.25em] font-semibold leading-snug">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-4 text-[1.12em] font-semibold">{children}</h5>,
  p: ({ children }) => <p className="my-2.5">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1.5 pl-6 marker:text-violet-400">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1.5 pl-6 marker:text-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 [&>p]:my-0">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-[3px] border-violet-300 pl-4 text-[0.95em] text-muted [&>p]:my-1">{children}</blockquote>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-muted">{children}</em>,
  hr: () => <hr className="my-6 border-line" />,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.88em]">{children}</code>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[0.92em]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-line bg-slate-50 px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    // a right-aligned cell is a number with its unit: it stays on one line
    <td style={style} className={`border border-line px-2.5 py-1.5 align-top ${style?.textAlign === "right" ? "whitespace-nowrap" : ""}`}>
      {children}
    </td>
  ),
  a: Anchor,
};

/** A note's body: Markdown drawn the way Obsidian's reading view draws it. */
export function NoteBody({ markdown, onJump }: { markdown: string; onJump: (id: string) => void }) {
  return (
    <JumpContext.Provider value={onJump}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </JumpContext.Provider>
  );
}
