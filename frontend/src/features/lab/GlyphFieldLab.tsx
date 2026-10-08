import { useState } from "react";
import { GlyphField } from "../../components/glyph-field/GlyphField";
import { BRAND, FLAME } from "../../components/glyph-field/palette";

const PALETTES = { "Orange and blue": FLAME, "Product blues": BRAND } as const;

/** A place to look at the glyph field and tune it. Not linked from anywhere. */
export default function GlyphFieldLab() {
  const [name, setName] = useState<keyof typeof PALETTES>("Orange and blue");
  const [size, setSize] = useState(8);
  return (
    <main className="relative min-h-screen overflow-hidden bg-surface text-ink">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ maskImage: "radial-gradient(ellipse 130% 115% at 100% 100%, black 35%, transparent 95%)" }}
      >
        <GlyphField palette={PALETTES[name]} cell={[size, Math.round(size * 1.6)]} className="h-full w-full" />
      </div>
      <div className="relative flex min-h-screen flex-col justify-between p-10">
        <h1 className="max-w-xl text-5xl font-semibold tracking-tight">A field of colour, drawn in text.</h1>
        <form className="flex flex-wrap items-center gap-4 text-sm" onSubmit={(e) => e.preventDefault()}>
          <label className="flex items-center gap-2">
            Palette
            <select value={name} onChange={(e) => setName(e.target.value as keyof typeof PALETTES)} className="rounded-lg border border-line bg-surface px-2 py-1">
              {Object.keys(PALETTES).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Glyph size
            <input type="range" min={5} max={16} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            {size}px
          </label>
        </form>
      </div>
    </main>
  );
}
