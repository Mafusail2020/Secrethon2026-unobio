/** One row of glyphs, white on black, each in a cell of the given size in device pixels. */
export function makeAtlas(glyphs: string[], cellW: number, cellH: number, font: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cellW * glyphs.length;
  canvas.height = cellH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas to draw the glyphs on");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${Math.round(cellH * 0.8)}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  glyphs.forEach((g, i) => ctx.fillText(g, i * cellW + cellW / 2, cellH / 2 + cellH * 0.04));
  return canvas;
}
