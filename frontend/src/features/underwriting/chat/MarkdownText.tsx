import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UnderwritingReport } from "../../../api/types";
import { withCitationLinks } from "./citations";

const urlTransform = (url: string) => (url.startsWith("claim:") ? url : defaultUrlTransform(url));

const heading = "font-semibold first:mt-0";

/** Markdown the model wrote, drawn with the workspace's own styles. Raw HTML is never rendered. */
export function MarkdownText({
  text,
  ids,
  report,
  onOpenClaim,
}: {
  text: string;
  ids: string[];
  report: UnderwritingReport | undefined;
  onOpenClaim: (claimId: string) => void;
}) {
  const components: Components = {
    h1: ({ children }) => <h2 className={`mb-2 mt-6 border-b border-line pb-1 text-base ${heading}`}>{children}</h2>,
    h2: ({ children }) => <h2 className={`mb-2 mt-6 border-b border-line pb-1 text-base ${heading}`}>{children}</h2>,
    h3: ({ children }) => <h3 className={`mb-1 mt-4 text-sm ${heading}`}>{children}</h3>,
    h4: ({ children }) => <h4 className={`mb-1 mt-3 text-sm ${heading}`}>{children}</h4>,
    p: ({ children }) => <p className="my-2">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    code: ({ children }) => <code className="rounded bg-slate-100 px-1 text-[0.85em]">{children}</code>,
    blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-line pl-3 text-muted">{children}</blockquote>,
    hr: () => <hr className="my-4 border-line" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border border-line bg-slate-50 px-2 py-1 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
    a: ({ href, children }) => {
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
              className="mx-0.5 inline-block rounded bg-brand/10 px-1 text-[0.7rem] font-medium leading-4 text-brand hover:bg-brand/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              {children}
            </button>
          </sup>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="text-brand underline">
          {children}
        </a>
      );
    },
  };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
      {withCitationLinks(text, ids)}
    </ReactMarkdown>
  );
}
