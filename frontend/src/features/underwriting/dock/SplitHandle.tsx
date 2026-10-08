import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const MIN = 25;
const MAX = 70;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/** The bar between the conversation and the views. `value` is the views' share of the row, in percent. */
export function SplitHandle({
  value,
  onChange,
  onCommit,
  onDragging,
  row,
}: {
  value: number;
  onChange: (percent: number) => void;
  onCommit: (percent: number) => void;
  /** true while the bar is being dragged, so the panel can follow it without easing */
  onDragging?: (dragging: boolean) => void;
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
    onDragging?.(false);
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
        onDragging?.(true);
        latest.current = value;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      data-print-hide
      className="absolute inset-y-0 left-0 z-20 hidden w-1.5 cursor-col-resize touch-none bg-line/40 transition-colors hover:bg-brand/40 focus-visible:bg-brand/50 focus-visible:outline-none xl:block"
    />
  );
}
