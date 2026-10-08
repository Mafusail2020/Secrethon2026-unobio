/** The open/close control of a card or a row: a round button-looking disc with an arrow that turns down when open. */
export function Chevron({ open, size = "lg" }: { open: boolean; size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm ${big ? "h-9 w-9" : "h-7 w-7"} ${open ? "bg-canvas" : ""}`}
    >
      <svg
        viewBox="0 0 20 20"
        className={`transition-transform duration-200 motion-reduce:transition-none ${big ? "h-5 w-5" : "h-4 w-4"} ${open ? "rotate-90" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 4l6 6-6 6" />
      </svg>
    </span>
  );
}
