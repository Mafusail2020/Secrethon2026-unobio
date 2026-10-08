export const VERT = `#version 300 es
void main() {
  // one triangle that covers the screen
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * Pass 1: a slowly flowing field. Fractal noise is bent by itself twice (domain warping), which gives the
 * long folded streaks, and the pointer pushes the lookup around it like a finger in paint.
 */
export const FIELD_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPush;
uniform vec3 uPal[6];
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
vec3 ramp(float v) {
  float x = clamp(v, 0.0, 1.0) * 5.0;
  int i = int(min(floor(x), 4.0));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uPal[i], uPal[i + 1], f);
}

void main() {
  vec2 frag = gl_FragCoord.xy / uRes;
  vec2 uv = gl_FragCoord.xy / uRes.y;
  vec2 pointer = uPointer * vec2(uRes.x / uRes.y, 1.0);
  vec2 d = uv - pointer;
  uv += d * exp(-dot(d, d) * 14.0) * 0.4 * uPush;

  float t = uTime * 0.05;
  // tall, narrow structures that rise: squeeze the noise across and stretch it up, and let it climb
  vec2 p = vec2(uv.x * 2.2 + uv.y * 0.35, uv.y * 0.95 - t * 0.9);
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.5 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p + 3.0 * r);

  // light mist upper left, deeper colour lower right
  float v = f * 1.35 - 0.12 + (1.0 - frag.x) * 0.3 + frag.y * 0.35 - 0.3;
  v = smoothstep(0.08, 0.92, v);

  // a lattice of tall rhombi, bent by the same noise and showing only in patches; the second pass colours it
  vec2 lw = uv + 0.05 * (vec2(fbm(uv * 3.0 + t * 2.0), fbm(uv * 3.0 + 7.0 - t * 2.0)) - 0.5);
  vec2 lp = vec2(lw.x / 0.075, lw.y / 0.125);
  float l1 = abs(fract(lp.x + lp.y) - 0.5) * 2.0;
  float l2 = abs(fract(lp.x - lp.y) - 0.5) * 2.0;
  // a gaussian edge: soft on both sides instead of a hard cut
  float lat = max(exp(-pow(l1 / 0.3, 2.0)), exp(-pow(l2 / 0.3, 2.0)));
  float pocket = smoothstep(0.22, 0.62, fbm(uv * 1.2 + vec2(3.0, t)));

  o = vec4(ramp(v), lat * pocket);
}`;

/**
 * Pass 2: split the screen into cells, read the field once per cell, and draw the glyph whose ink matches how
 * dark that cell is. A random threshold per cell nudges the choice, so the change from one glyph to the next breaks
 * up into a scatter of mixed letters instead of a hard line. The smooth field shows through between the strokes.
 */
export const GLYPH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uAtlas;
uniform vec2 uRes;
uniform vec2 uCell;
uniform float uCount;
uniform vec2 uLum;
uniform float uLattice;
uniform float uNear;
uniform float uTime;
uniform vec3 uPal[6];
uniform float uBackdrop;
uniform float uStroke;
uniform float uGlow;
out vec4 o;

// a different threshold per cell, so neighbouring cells of one density mix their letters like a read sequence
float jitter(vec2 c) {
  return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
}

// the average colour of the field in a ring around a point: what a line there should take after
vec3 around(vec2 uv) {
  vec2 r = vec2(uNear) / uRes;
  vec2 d = r * 0.7071;
  vec3 s = texture(uField, uv + vec2(r.x, 0.0)).rgb + texture(uField, uv - vec2(r.x, 0.0)).rgb
         + texture(uField, uv + vec2(0.0, r.y)).rgb + texture(uField, uv - vec2(0.0, r.y)).rgb
         + texture(uField, uv + d).rgb + texture(uField, uv - d).rgb
         + texture(uField, uv + vec2(d.x, -d.y)).rgb + texture(uField, uv + vec2(-d.x, d.y)).rgb;
  return s / 8.0;
}

vec3 ramp(float v) {
  float x = clamp(v, 0.0, 1.0) * 5.0;
  int i = int(min(floor(x), 4.0));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uPal[i], uPal[i + 1], f);
}

// the colour a line wears here: it floats along the palette with time, and differently across the screen
vec3 lineTint(vec2 uv) {
  float ph = 0.5 + 0.5 * sin(uTime * 0.11 + uv.x * 4.0 + uv.y * 2.5 + sin(uTime * 0.07 + uv.y * 3.0));
  return ramp(mix(0.25, 0.9, ph));
}

// the field at a point with the lattice laid over it. A line is part the colour of the cells around it and part the
// drifting tint; with glow it is also never darker than the field.
vec3 laid(vec2 uv) {
  vec4 f = texture(uField, uv);
  vec3 line = mix(around(uv), lineTint(uv), 0.6);
  line = uGlow > 0.5 ? max(f.rgb, mix(line, vec3(1.0), 0.2)) : mix(line, vec3(1.0), 0.1);
  return mix(f.rgb, line, f.a * uLattice);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 cell = floor(px / uCell);
  vec3 under = laid(px / uRes);
  vec3 c = laid((cell + 0.5) * uCell / uRes);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));

  // darkness within this palette's own range, so a pale palette still uses every glyph
  float dark = 1.0 - clamp((lum - uLum.x) / max(uLum.y - uLum.x, 0.001), 0.0, 1.0);
  float idx = floor(clamp(dark * uCount + (jitter(cell) - 0.5) * 1.6, 0.0, uCount - 0.001));
  vec2 inCell = fract(px / uCell);
  float ink = texture(uAtlas, vec2((idx + inCell.x) / uCount, 1.0 - inCell.y)).r;

  // strokes are a little lighter on dark ground and a little darker on light ground; uStroke says how much.
  // With uGlow they are always lighter, so nothing on the screen is darker than the field itself.
  vec3 target = uGlow > 0.5 ? mix(c, vec3(1.0), 0.6) : (lum > 0.5 ? c * 0.72 : c * 1.3 + 0.06);
  vec3 stroke = mix(c, target, uStroke);
  o = vec4(mix(under * uBackdrop, stroke, ink), 1.0);
}`;
