import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { getApi } from "../../../api/client";
import { PassageQuote } from "./passage";
import { passageLabel } from "./passageLabel";

/** The passages of the user's own files an answer rests on. Each chip opens the quote it points at. */
export function PassageChips({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState<string | undefined>();
  const lookups = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["evidence", id],
      queryFn: async () => (await getApi()).getEvidence(id),
      staleTime: Infinity,
      retry: false,
    })),
  });
  if (!ids.length) return null;
  const shown = ids.map((id, i) => ({ id, found: lookups[i]?.data, failed: lookups[i]?.isError }));
  const current = shown.find((s) => s.id === open)?.found;

  return (
    <div className="mt-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Passages of your files this answer rests on">
        {shown.map(({ id, found, failed }) => {
          const { name, where } = found ? passageLabel(found) : { name: failed ? "Passage" : "Loading", where: "" };
          return (
            <li key={id}>
              <button
                type="button"
                aria-expanded={open === id}
                disabled={!found}
                onClick={() => setOpen((o) => (o === id ? undefined : id))}
                className="max-w-[18rem] truncate rounded-full border border-line bg-slate-100 px-2.5 py-1 text-xs text-ink hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
                title={found ? `${name}${where}` : undefined}
              >
                {name}
                {where}
              </button>
            </li>
          );
        })}
      </ul>
      {current && <PassageQuote detail={current} className="uw-fade mt-2" />}
    </div>
  );
}
