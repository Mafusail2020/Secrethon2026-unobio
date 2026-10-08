import type { UnderwritingReport } from "../../../api/types";

/** The claims an answer rests on; each one opens that claim in the report. */
export function ClaimChips({
  ids,
  report,
  onOpen,
}: {
  ids: string[];
  report: UnderwritingReport | undefined;
  onOpen: (claimId: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Claims this answer rests on">
      {ids.map((id) => {
        const claim = report?.claims[id];
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(id)}
              className="max-w-[18rem] truncate rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-brand hover:border-brand"
              title={claim?.text}
            >
              {claim ? claim.text : id}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
