/**
 * Claims for and against, as weights (confidence, halved for a downgrade): for grows left from the middle in green,
 * against grows right in red. `scale` is the largest weight on either side anywhere in the tree, so bars compare.
 */
export function BalanceBar({ pro, con, scale, label }: { pro: number; con: number; scale: number; label: string }) {
  const half = (value: number) => `${scale > 0 ? Math.min(50, (value / scale) * 50) : 0}%`;
  return (
    <div role="img" aria-label={label} className="relative h-2 w-full rounded-full bg-slate-200/80">
      <span className="absolute inset-y-0 right-1/2 rounded-l-full bg-emerald-500" style={{ width: half(pro) }} />
      <span className="absolute inset-y-0 left-1/2 rounded-r-full bg-red-400" style={{ width: half(con) }} />
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-slate-500/70" aria-hidden="true" />
    </div>
  );
}
