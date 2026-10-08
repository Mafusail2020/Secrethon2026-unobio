import type { ReactNode } from "react";

/**
 * A block that opens to its natural height. Closed, it is neither focusable nor read out; on paper it is always open
 * (styles/print.css), so a printed report is the whole tree.
 */
export function Collapse({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return (
    <div id={id} data-open={open} aria-hidden={!open} inert={!open} className="uw-collapse">
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
