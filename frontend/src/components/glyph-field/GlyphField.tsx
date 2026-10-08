import { useEffect, useRef } from "react";
import { DEFAULT_RAMP, FLAME } from "./palette";
import { createGlyphField } from "./renderer";

const FONT = `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

export interface GlyphFieldProps {
  /** colours from the darkest to the lightest */
  palette?: string[];
  /** glyphs from the lightest area to the darkest */
  ramp?: string;
  /** glyph cell in CSS pixels: width, height */
  cell?: [number, number];
  /** 0 hides the strokes in the ground's own colour, 1 contrasts them with it */
  strokeContrast?: number;
  /** 1 is the shader's own pace; the default is half of it, a slow drift */
  speed?: number;
  /** how hard the pointer pushes the field, 0 to 1 */
  push?: number;
  /** strokes only lighter than the ground, never darker: the field's darkest stop is then the worst case for text over it */
  glow?: boolean;
  /** 0 to 1: how strongly a lattice of tall rhombi shows through the field */
  lattice?: number;
  /** 0 to 1: how much each rhombus is a pane of glass that bends and bevels the field behind it */
  glass?: number;
  /** 1 shows the field's colours as they are; less dims them between the strokes */
  backdrop?: number;
  className?: string;
}

/**
 * A flowing field of colour drawn in text. The pointer pushes it around; with reduced motion it is one still frame.
 * Draws nothing where there is no WebGL2, so whatever is behind the canvas stays.
 */
export function GlyphField({ palette = FLAME, ramp = DEFAULT_RAMP, cell = [9, 14], strokeContrast = 1, speed = 0.5, push = 1, backdrop = 0.92, glow = false, lattice = 0, glass = 0, className }: GlyphFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paletteKey = palette.join(",");
  const [cellW, cellH] = cell;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const field = createGlyphField(canvas, {
      palette: paletteKey.split(","),
      ramp,
      cell: [cellW, cellH],
      font: FONT,
      maxDpr: 1.5,
      fieldScale: 0.5,
      backdrop,
      stroke: strokeContrast,
      glow,
      lattice,
      glass,
    });
    // a canvas that failed to start is opaque black: hide it so whatever is behind it shows
    canvas.hidden = !field;
    if (!field) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, push: 0, active: false };
    let seconds = 12; // a still frame should already have something in it
    let last = 0;
    let raf = 0;
    let visible = true;

    const draw = () => field.render(seconds, pointer.x, pointer.y, pointer.push);
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      seconds += dt * speed;
      const follow = 1 - Math.exp(-dt * 8);
      pointer.x += (pointer.tx - pointer.x) * follow;
      pointer.y += (pointer.ty - pointer.y) * follow;
      pointer.push += ((pointer.active ? push : 0) - pointer.push) * (1 - Math.exp(-dt * 3));
      draw();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (calm || raf || !visible || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      pointer.active = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (pointer.active) {
        pointer.tx = x;
        pointer.ty = y;
      }
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const onVisible = () => start();

    const resizer = new ResizeObserver(() => {
      field.resize();
      draw();
    });
    resizer.observe(canvas);
    const watcher = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) start();
    });
    watcher.observe(canvas);

    draw();
    if (!calm) {
      window.addEventListener("pointermove", onMove);
      document.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisible);
    }
    start();

    return () => {
      cancelAnimationFrame(raf);
      resizer.disconnect();
      watcher.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
      field.destroy();
    };
  }, [paletteKey, ramp, cellW, cellH, strokeContrast, speed, push, backdrop, glow, lattice, glass]);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
