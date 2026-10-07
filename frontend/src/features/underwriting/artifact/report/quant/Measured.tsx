import { useEffect, useRef, useState, type ReactNode } from "react";

/** Gives its child the pixel width it has, so an SVG can be drawn 1:1 instead of scaled (no fat bars on wide screens). */
export function Measured({ children }: { children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="min-w-0">
      {width > 0 && children(width)}
    </div>
  );
}
