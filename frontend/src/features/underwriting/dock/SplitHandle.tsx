import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const MIN = 25;
const MAX = 70;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/** The bar between the conversation and the views. `value` is the views' share of the row, in percent. */
export function SplitHandle({
  value,
  onChange,
  onCommit,
  row,
}: {
  value: number;
  onChange: (percent: number) => void;
  onCommit: (percent: number) => void;
  row: RefObject<HTMLElement | null>;
}) {
  const dragging = useRef(false);
  const latest = useRef(value);

  const move = (event: PointerEvent) => {
    const box = row.current?.getBoundingClientRect();
    if (!dragging.current || !box?.width) return;
    latest.current = clamp(((box.right - event.clientX) / box.width) * 100);
    onChange(latest.current);
  };
  const end = (event: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(latest.current);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowLeft" ? 3 : event.key === "ArrowRight" ? -3 : 0;
    if (!step) return;
    event.preventDefault();
    onChange(clamp(value + step));
    onCommit(clamp(value + step));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the conversation and the views"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true;
        latest.current = value;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      data-print-hide
      className="group hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-line/40 transition-colors hover:bg-brand/40 focus-visible:bg-brand/50 focus-visible:outline-none xl:block"
    />
  );
}
