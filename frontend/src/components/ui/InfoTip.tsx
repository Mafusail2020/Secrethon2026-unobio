import { useId, type ReactNode } from "react";

/** Hover and keyboard-focus tooltip. The trigger stays whatever you pass as children. */
export function InfoTip({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} aria-describedby={id} className="inline-flex cursor-help rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-line bg-white p-2 text-xs shadow-lg group-focus-within:visible group-hover:visible"
      >
        <span className="block font-semibold">{title}</span>
        <span className="block text-muted">{body}</span>
      </span>
    </span>
  );
}
