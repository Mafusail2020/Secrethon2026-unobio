import { useState } from "react";
import { useEvidenceDetail } from "../../../api/hooks";
import { PassageQuote } from "./passage";
import { passageLabel } from "./passageLabel";

/** One line of the list of sources a briefing cites, for a passage of the user's own file: its name opens the quote. */
export function PassageEntry({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const found = useEvidenceDetail(id);
  const label = found.data ? passageLabel(found.data) : undefined;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        disabled={!found.data}
        onClick={() => setOpen((o) => !o)}
        className="text-left text-ink hover:underline disabled:no-underline disabled:opacity-60"
      >
        {label ? `${label.name}${label.where}` : found.isError ? "Passage from your files" : "Loading the passage"}
      </button>
      {open && found.data && <PassageQuote detail={found.data} className="uw-fade mt-1" />}
    </>
  );
}
