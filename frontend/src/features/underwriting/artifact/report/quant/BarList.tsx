/** Labelled horizontal bars drawn in SVG, longest first when `sort` is set. */
export function BarList({
  items,
  tone = "fill-brand",
}: {
  items: { label: string; value: number }[];
  tone?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,7rem)_1fr_1.5rem] items-center gap-2 text-xs">
          <span className="truncate" title={item.label}>
            {item.label}
          </span>
          <svg viewBox="0 0 100 8" className="h-2 w-full" role="img" aria-label={`${item.label}: ${item.value}`} preserveAspectRatio="none">
            <rect width="100" height="8" rx="3" className="fill-line" />
            <rect width={(item.value / max) * 100} height="8" rx="3" className={tone} />
          </svg>
          <span className="text-right tabular-nums text-muted">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}
