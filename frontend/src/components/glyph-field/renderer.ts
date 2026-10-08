import { makeAtlas } from "./atlas";
import { type Rgb, parseRamp, resamplePalette } from "./palette";
import { FIELD_FRAG, GLYPH_FRAG, VERT } from "./shaders";

export interface GlyphFieldOptions {
  palette: string[];
  ramp: string;
  /** glyph cell in CSS pixels */
  cell: [number, number];
  font: string;
  maxDpr: number;
  /** the field is drawn smaller than the screen; the stretch is its softness */
  fieldScale: number;
  /** how much of the smooth field shows between strokes */
  backdrop: number;
  /** 0 draws strokes in the field's own colour (they vanish); 1 contrasts them with it */
  stroke: number;
  /** strokes only ever lighter than the field, so the field's darkest colour stays the darkest thing on screen */
  glow: boolean;
  /** 0 to 1: how strongly the lattice of rhombi shows */
  lattice: number;
}

export interface GlyphFieldHandle {
  /** draws one frame; pointer is 0..1 with y up */
  render(seconds: number, pointerX: number, pointerY: number, push: number): void;
  resize(): void;
  destroy(): void;
}

function program(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const make = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader failed to compile");
    return shader;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vert));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program failed to link");
  return p;
}

function texture(gl: WebGL2RenderingContext, unit: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Null when this browser has no WebGL2; the caller keeps whatever is behind the canvas. */
export function createGlyphField(canvas: HTMLCanvasElement, opts: GlyphFieldOptions): GlyphFieldHandle | null {
  if (typeof WebGL2RenderingContext === "undefined") return null;
  try {
    return build(canvas, opts);
  } catch (error) {
    // a decoration must never take the page down with it
    console.warn("glyph field disabled:", error);
    return null;
  }
}

function build(canvas: HTMLCanvasElement, opts: GlyphFieldOptions): GlyphFieldHandle | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;

  const glyphs = parseRamp(opts.ramp);
  const palette: Rgb[] = resamplePalette(opts.palette);
  const palFlat = new Float32Array(palette.flat());
  const lums = palette.map(([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b);
  const fieldProg = program(gl, VERT, FIELD_FRAG);
  const glyphProg = program(gl, VERT, GLYPH_FRAG);
  const fieldTex = texture(gl, 0);
  const atlasTex = texture(gl, 1);
  const fbo = gl.createFramebuffer()!;
  let size = { w: 1, h: 1, fw: 1, fh: 1, cw: 1, ch: 1 };

  const loc = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const cw = Math.max(2, Math.round(opts.cell[0] * dpr));
    const ch = Math.max(2, Math.round(opts.cell[1] * dpr));
    const fw = Math.max(2, Math.round(w * opts.fieldScale));
    const fh = Math.max(2, Math.round(h * opts.fieldScale));
    canvas.width = w;
    canvas.height = h;
    size = { w, h, fw, fh, cw, ch };

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeAtlas(glyphs, cw, ch, opts.font));
  };
  resize();

  const render: GlyphFieldHandle["render"] = (seconds, pointerX, pointerY, push) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, size.fw, size.fh);
    gl.useProgram(fieldProg);
    gl.uniform2f(loc(fieldProg, "uRes"), size.fw, size.fh);
    gl.uniform1f(loc(fieldProg, "uTime"), seconds);
    gl.uniform2f(loc(fieldProg, "uPointer"), pointerX, pointerY);
    gl.uniform1f(loc(fieldProg, "uPush"), push);
    gl.uniform1f(loc(fieldProg, "uLattice"), opts.lattice);
    gl.uniform3fv(loc(fieldProg, "uPal"), palFlat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.useProgram(glyphProg);
    gl.uniform1i(loc(glyphProg, "uField"), 0);
    gl.uniform1i(loc(glyphProg, "uAtlas"), 1);
    gl.uniform2f(loc(glyphProg, "uRes"), size.w, size.h);
    gl.uniform2f(loc(glyphProg, "uCell"), size.cw, size.ch);
    gl.uniform1f(loc(glyphProg, "uCount"), glyphs.length);
    gl.uniform2f(loc(glyphProg, "uLum"), Math.min(...lums), Math.max(...lums));
    gl.uniform1f(loc(glyphProg, "uBackdrop"), opts.backdrop);
    gl.uniform1f(loc(glyphProg, "uStroke"), opts.stroke);
    gl.uniform1f(loc(glyphProg, "uGlow"), opts.glow ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return {
    render,
    resize,
    destroy() {
      gl.deleteProgram(fieldProg);
      gl.deleteProgram(glyphProg);
      gl.deleteTexture(fieldTex);
      gl.deleteTexture(atlasTex);
      gl.deleteFramebuffer(fbo);
    },
  };
}
