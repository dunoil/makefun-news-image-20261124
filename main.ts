// Tuesday 24 November 2026: one broadsheet image of the day's world news.
// Drawn programmatically, standard library only, no network, deterministic.
// News research: web search on 24 Nov 2026; every story below was first
// reported on 24 November 2026 in some timezone. Earlier stories are named
// in the DATE CHECK footer and kept out of the page.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024, H = 1024;

// ---------- PNG encoder (RGB, filter 0, deterministic) ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((v, i) => { raw[y * (1 + w * 3) + 1 + i] = v; });
  }
  const head = Buffer.alloc(8);
  head.writeUInt32BE(0x89504e47, 0); head.writeUInt32BE(0x0d0a1a0a, 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([head, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- seeded PRNG (deterministic paper grain) ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- raster canvas ----------
type RGB = [number, number, number];
const PAPER: RGB = [247, 242, 231];
const INK: RGB = [26, 26, 26];
const RED: RGB = [163, 30, 34];
const NAVY: RGB = [31, 78, 121];
const GOLD: RGB = [176, 141, 58];
const GREY: RGB = [105, 100, 90];
const LIGHT: RGB = [255, 252, 245];

class Canvas {
  buf = new Uint8Array(W * H * 3);
  constructor() { this.fill(PAPER); }
  set(x: number, y: number, c: RGB) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const i = (yi * W + xi) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  fill(c: RGB) { for (let i = 0; i < W * H; i++) { this.buf[i * 3] = c[0]; this.buf[i * 3 + 1] = c[1]; this.buf[i * 3 + 2] = c[2]; } }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
    }
  }
  // even-odd scanline polygon fill
  poly(pts: number[][], c: RGB) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) this.set(x, y, c);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + dx * i / n, y0 + dy * i / n, c);
  }
  // thick line as a filled quad plus round caps
  thick(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * w / 2, ny = dx / len * w / 2;
    this.poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c);
    this.circle(x0, y0, w / 2, c); this.circle(x1, y1, w / 2, c);
  }
  circle(cx: number, cy: number, r: number, c: RGB) {
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
      const dy = y - cy, dx = Math.sqrt(Math.max(0, r2 - dy * dy));
      for (let x = Math.max(0, Math.ceil(cx - dx)); x <= Math.min(W - 1, Math.floor(cx + dx)); x++) this.set(x, y, c);
    }
  }
  ring(cx: number, cy: number, r: number, w: number, c: RGB) {
    for (let a = 0; a < 360; a += 1) {
      const rad = a * Math.PI / 180;
      for (let rr = r - w / 2; rr <= r + w / 2; rr += 0.7) this.set(cx + Math.cos(rad) * rr, cy + Math.sin(rad) * rr, c);
    }
  }
}

// ---------- stroke serif font ----------
// Glyphs on a 7-wide grid, cap height 10 units, baseline 10, descender to 14.
// Polylines are "x,y x,y ..." strings. Capitals carry small serif ticks.
const G: Record<string, string[]> = {
  A: ['0,10 3,0 6,10', '1.6,6.5 4.4,6.5', '0,10 1,10', '5,10 6,10'],
  B: ['0,0 0,10', '0,0 4,0 5.5,1.5 5.5,3.5 4,5 0,5', '4,5 5.5,6.5 5.5,8.5 4,10 0,10', '0,0 1,0', '0,10 1,10'],
  C: ['6,2 4,0 1.5,0 0,2 0,8 1.5,10 4,10 6,8'],
  D: ['0,0 0,10', '0,0 3.5,0 6,2.5 6,7.5 3.5,10 0,10', '0,0 1,0', '0,10 1,10'],
  E: ['0,0 0,10', '0,0 5.5,0', '0,5 4,5', '0,10 5.5,10', '0,0 1,0', '0,10 1,10'],
  F: ['0,0 0,10', '0,0 5.5,0', '0,5 4,5', '0,0 1,0', '0,10 1,10'],
  G: ['6,2 4,0 1.5,0 0,2 0,8 1.5,10 4,10 6,8 6,6', '6,6 3.5,6'],
  H: ['0,0 0,10', '6,0 6,10', '0,5 6,5', '0,0 1,0', '0,10 1,10', '5,0 6,0', '5,10 6,10'],
  I: ['1.5,0 4.5,0', '3,0 3,10', '1.5,10 4.5,10'],
  J: ['6,0 6,8 4,10 1.5,10 0,8', '5,0 6,0'],
  K: ['0,0 0,10', '5.5,0 0,5 5.5,10', '0,0 1,0', '0,10 1,10'],
  L: ['0,0 0,10', '0,10 5.5,10', '0,0 1,0', '0,10 1,10'],
  M: ['0,10 0,0 3,5 6,0 6,10', '0,0 1,0', '5,0 6,0', '0,10 1,10', '5,10 6,10'],
  N: ['0,10 0,0 6,10 6,0', '0,0 1,0', '5,0 6,0', '0,10 1,10', '5,10 6,10'],
  O: ['1.5,0 4.5,0 6,2 6,8 4.5,10 1.5,10 0,8 0,2 1.5,0'],
  P: ['0,0 0,10', '0,0 4.5,0 6,1.5 6,3.5 4.5,5 0,5', '0,0 1,0', '0,10 1,10'],
  Q: ['1.5,0 4.5,0 6,2 6,8 4.5,10 1.5,10 0,8 0,2 1.5,0', '3.5,7 6,10'],
  R: ['0,0 0,10', '0,0 4.5,0 6,1.5 6,3.5 4.5,5 0,5', '3,5 6,10', '0,0 1,0', '0,10 1,10'],
  S: ['5.5,2 4,0 2,0 0.5,1.5 0.5,3.5 2,5 4,5 5.5,6.5 5.5,8.5 4,10 2,10 0.5,8'],
  T: ['0,0 6,0', '3,0 3,10', '2,10 4,10'],
  U: ['0,0 0,8 1.5,10 4.5,10 6,8 6,0', '0,0 1,0', '5,0 6,0'],
  V: ['0,0 3,10 6,0', '0,0 1,0', '5,0 6,0', '2.5,10 3.5,10'],
  W: ['0,0 1.5,10 3,4 4.5,10 6,0', '0,0 1,0', '5,0 6,0'],
  X: ['0,0 6,10', '6,0 0,10'],
  Y: ['0,0 3,5 6,0', '3,5 3,10', '2,10 4,10'],
  Z: ['0,0 6,0 0,10 6,10', '0,0 1,0', '5,10 6,10'],
  a: ['5.5,4 5.5,10', '5.5,5 4,4 2,4 0.8,5.5 0.8,8 2,10 4,10 5.5,9'],
  b: ['0,0 0,10', '0,6 2,4 4,4 5.5,5.5 5.5,8 4,10 2,10 0,8'],
  c: ['5.5,6 4,4 2,4 0.8,5.5 0.8,8 2,10 4,10 5.5,9'],
  d: ['6,0 6,10', '6,6 4,4 2,4 0.8,5.5 0.8,8 2,10 4,10 6,9'],
  e: ['0.8,7 1.5,4.5 3,4 4.5,4.5 5.5,6.5 5.5,8 4,10 2,10 0.8,9', '0.8,7 5,7'],
  f: ['4,0 2,0 1,1 1,10', '1,4 4.5,4'],
  g: ['5.5,4 5.5,8 4,10 2,10 0.8,8.5 0.8,6 2,4 4,4 5.5,5.5', '5.5,8 5.5,12 4,13.5 2,13.5 0.8,12'],
  h: ['0,0 0,10', '0,6 2,4 4,4 5.5,5.5 5.5,10'],
  i: ['3,4 3,10', '3,0 3,1.5'],
  j: ['3.5,4 3.5,12 2,13.5 0.8,13', '3.5,0 3.5,1.5'],
  k: ['0,0 0,10', '5.5,4 0,7 5.5,10'],
  l: ['3,0 3,10'],
  m: ['0,4 0,10', '0,5.5 1.5,4 2.8,4 3,5.5 3,10', '3,5.5 4.5,4 6,5.5 6,10'],
  n: ['0,4 0,10', '0,6 1.5,4 3.5,4 5.5,5.5 5.5,10'],
  o: ['1.5,4 3,4 4.5,4.5 5.5,6 5.5,8 4.5,9.5 3,10 1.5,9.5 0.5,8 0.5,6 1.5,4'],
  p: ['0,4 0,14', '0,7 2,4 4,4 5.5,5.5 5.5,8 4,10 2,10 0,8'],
  q: ['6,4 6,14', '6,7 4,4 2,4 0.5,5.5 0.5,8 2,10 4,10 6,8'],
  r: ['0,4 0,10', '0,6 1.5,4 3.5,4 5,5'],
  s: ['5.5,5.5 4,4 2,4 0.8,5.5 0.8,7 2,8 4,8 5.5,9.5 4.5,10.5 2.5,10.5 0.8,9.5'],
  t: ['2.5,0 2.5,12.5 4,13.5 5,13', '0.5,4 4.5,4'],
  u: ['0,4 0,8.5 1.5,10 4,10 5.5,8.5 5.5,4'],
  v: ['0,4 3,10 6,4'],
  w: ['0,4 1.5,10 3,6 4.5,10 6,4'],
  x: ['0,4 6,10', '6,4 0,10'],
  y: ['0,4 3,10 6,4', '3,10 3,13.5 1.5,14 0.5,13.5'],
  z: ['0,4 6,4 0,10 6,10'],
  '0': ['1.5,0 4.5,0 6,2 6,8 4.5,10 1.5,10 0,8 0,2 1.5,0'],
  '1': ['3,0 3,10', '1,2 3,0', '1.5,10 4.5,10'],
  '2': ['0.5,2 1.5,0 4.5,0 5.5,2 5.5,4 0.5,10 5.5,10'],
  '3': ['0.5,1 2,0 4,0 5.5,1.5 5.5,3.5 4,5 5.5,6.5 5.5,8.5 4,10 2,10 0.5,9'],
  '4': ['4.5,0 0.5,7 5.5,7', '4,0 4,10'],
  '5': ['5.5,0 0.5,0 0.5,4.5 4,4.5 5.5,6 5.5,8.5 4,10 2,10 0.5,8.5'],
  '6': ['5.5,1.5 4,0 2,0 0.5,2 0.5,8 2,10 4,10 5.5,8.5 5.5,6.5 4,5 2,5 0.8,6.5'],
  '7': ['0,0 6,0 2.5,10'],
  '8': ['2,0 4,0 5.5,1.5 5.5,3.5 4,5 2,5 0.5,6.5 0.5,8.5 2,10 4,10 5.5,8.5 5.5,6.5 4,5'],
  '9': ['0.5,8.5 2,10 4,10 5.5,8 5.5,2 4,0 2,0 0.5,1.5 0.5,3.5 2,5 4,5 5.5,3.5'],
  '.': ['2.5,9.5 3.5,9.5'],
  ',': ['2.5,9.5 3.5,9.5', '3,10 2,12'],
  ':': ['2.5,4 3.5,4', '2.5,9 3.5,9'],
  ';': ['2.5,4 3.5,4', '2.5,9 3.5,9', '3,10 2,12'],
  "'": ['3,0 2,2.5'],
  '(': ['4,0 2,2 2,8 4,10'],
  ')': ['2,0 4,2 4,8 2,10'],
  '/': ['5,0 1,10'],
  '%': ['0,0 6,10', '0.8,0.8 2.2,0.8 2.2,2.2 0.8,2.2 0.8,0.8', '3.8,7.8 5.2,7.8 5.2,9.2 3.8,9.2 3.8,7.8'],
  '$': ['3,0 3,10', '0.5,2 2,0.5 4,0.5 5.5,2 5.5,3.5 4,5 2,5 0.5,6.5 0.5,8 2,9.5 4,9.5 5.5,8', '0,3.5 6,3.5', '0,6.5 6,6.5'],
  '!': ['3,0 3,7', '2.5,9.5 3.5,9.5'],
  '?': ['1,2 2,0.5 4,0.5 5.5,2 5.5,4 4,5.5 3,6.5 3,8', '2.5,9.5 3.5,9.5'],
  '-': ['0.5,5 5.5,5'],
  '+': ['3,2 3,8', '0.5,5 5.5,5'],
  '&': ['5,8 4,9.5 2,9.5 1,8 1,6 2.5,4.5 5.5,0.5 5.5,2 4.5,4 2,6.5 0,9 1.5,10 3,10 5.5,8'],
  '=': ['0.5,3.5 5.5,3.5', '0.5,6.5 5.5,6.5'],
  '"': ['2,0 1.5,2', '4,0 3.5,2'],
  ' ': [],
};
const NARROW = new Set(['i', 'j', 'l', '1', '.', ',', ':', ';', "'", '!', '"']);
function adv(ch: string): number { return ch === ' ' ? 4.6 : NARROW.has(ch) ? 4.4 : (ch === 'm' || ch === 'w' || ch === 'M' || ch === 'W') ? 7.6 : 7; }

function textWidth(s: string, size: number): number {
  let w = 0; for (const ch of s) w += adv(ch);
  return w * size / 10;
}
function drawText(cv: Canvas, x: number, yTop: number, s: string, size: number, c: RGB, bold = false) {
  const sc = size / 10, lw = Math.max(1, Math.round(size * 0.11)) + (bold ? 1 : 0);
  let cx = x;
  for (const ch of s) {
    const strokes = G[ch];
    if (strokes) {
      for (const st of strokes) {
        const pts = st.split(' ').map(t => { const [a, b] = t.split(',').map(Number); return [cx + a * sc * 0.92, yTop + b * sc]; });
        for (let i = 0; i + 1 < pts.length; i++) cv.thick(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], lw, c);
      }
    }
    cx += adv(ch) * sc;
  }
  return cx;
}
function wrap(s: string, size: number, maxW: number): string[] {
  const words = s.split(' '), lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, size) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(cv: Canvas, x: number, y: number, s: string, size: number, maxW: number, c: RGB, maxLines: number, bold = false): number {
  const lines = wrap(s, size, maxW).slice(0, maxLines);
  lines.forEach((ln, i) => drawText(cv, x, y + i * size * 1.28, ln, size, c, bold));
  return y + lines.length * size * 1.28;
}

// ---------- illustrated scenes ----------
// Each scene draws inside a box (x, y, w, h) with a sky band and a ground band.
const SKY: RGB = [214, 230, 240];
const SKY2: RGB = [232, 222, 198];
const GROUND: RGB = [228, 218, 196];
const SEA: RGB = [120, 165, 195];
const FLAME: RGB = [224, 110, 30];
const SMOKE: RGB = [90, 88, 84];
const LEAF: RGB = [70, 110, 70];

function sceneBase(cv: Canvas, x: number, y: number, w: number, h: number, sky: RGB, ground: RGB) {
  cv.rect(x, y, w, h * 0.62, sky);
  cv.rect(x, y + h * 0.62, w, h * 0.38, ground);
}
function flagBox(cv: Canvas, x: number, y: number, w: number, h: number, kind: string) {
  cv.thick(x, y, x, y + h + 14, 1.5, INK);
  if (kind === 'ua') { cv.rect(x, y, w, h / 2, [40, 110, 200]); cv.rect(x, y + h / 2, w, h / 2, [255, 210, 0]); }
  else if (kind === 'ru') { cv.rect(x, y, w, h / 3, [240, 240, 240]); cv.rect(x, y + h / 3, w, h / 3, [30, 80, 190]); cv.rect(x, y + 2 * h / 3, w, h / 3, [200, 30, 30]); }
  else if (kind === 'us') {
    cv.rect(x, y, w, h, [190, 40, 40]);
    for (let i = 1; i < 7; i += 2) cv.rect(x, y + i * h / 7, w, h / 7, LIGHT);
    cv.rect(x, y, w * 0.45, h * 0.55, NAVY);
  } else if (kind === 'eu') {
    cv.rect(x, y, w, h, NAVY);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; cv.circle(x + w / 2 + Math.cos(a) * w * 0.26, y + h / 2 + Math.sin(a) * h * 0.26, 1.3, [255, 220, 60]); }
  }
  cv.line(x, y, x + w, y, INK); cv.line(x, y + h, x + w, y + h, INK);
  cv.line(x, y, x, y + h, INK); cv.line(x + w, y, x + w, y + h, INK);
}
function person(cv: Canvas, x: number, y: number, s: number, suit: RGB) {
  cv.circle(x, y, s * 0.32, [222, 184, 150]); // head
  cv.poly([[x - s * 0.42, y + s], [x + s * 0.42, y + s], [x + s * 0.3, y + s * 0.32], [x - s * 0.3, y + s * 0.32]], suit); // body
}
function flame(cv: Canvas, x: number, y: number, s: number) {
  cv.poly([[x - s * 0.5, y], [x - s * 0.2, y - s * 0.9], [x, y - s * 0.4], [x + s * 0.25, y - s * 1.1], [x + s * 0.5, y]], FLAME);
  cv.poly([[x - s * 0.25, y], [x, y - s * 0.5], [x + s * 0.25, y]], [255, 200, 60]);
}
function drawScene(cv: Canvas, id: number, x: number, y: number, w: number, h: number) {
  sceneBase(cv, x, y, w, h, id === 6 ? [200, 220, 235] : SKY, id === 5 || id === 10 ? SEA : GROUND);
  const gy = y + h * 0.62;
  if (id === 1) { // four-way talks: table, four flags, four people
    cv.rect(x + w * 0.14, gy - 6, w * 0.72, 8, [120, 80, 50]);
    cv.rect(x + w * 0.14, gy + 2, w * 0.72, h * 0.3, [150, 105, 65]);
    const fw = w * 0.13, fh = h * 0.16;
    flagBox(cv, x + w * 0.16, y + 8, fw, fh, 'ua');
    flagBox(cv, x + w * 0.36, y + 8, fw, fh, 'ru');
    flagBox(cv, x + w * 0.56, y + 8, fw, fh, 'us');
    flagBox(cv, x + w * 0.76, y + 8, fw, fh, 'eu');
    person(cv, x + w * 0.22, gy - 16, 13, NAVY);
    person(cv, x + w * 0.42, gy - 16, 13, [90, 90, 90]);
    person(cv, x + w * 0.62, gy - 16, 13, [120, 40, 40]);
    person(cv, x + w * 0.82, gy - 16, 13, [50, 90, 60]);
  } else if (id === 2) { // oil depot strike: tanks, flames, smoke, drone
    cv.rect(x + w * 0.08, gy - 26, w * 0.2, 26, [150, 150, 148]);
    cv.rect(x + w * 0.32, gy - 34, w * 0.24, 34, [170, 170, 168]);
    cv.rect(x + w * 0.62, gy - 22, w * 0.2, 22, [140, 140, 138]);
    cv.line(x + w * 0.08, gy - 26, x + w * 0.28, gy - 26, INK);
    flame(cv, x + w * 0.18, gy - 24, 16); flame(cv, x + w * 0.44, gy - 32, 20); flame(cv, x + w * 0.72, gy - 20, 14);
    cv.circle(x + w * 0.3, y + 12, 7, SMOKE); cv.circle(x + w * 0.45, y + 8, 9, SMOKE); cv.circle(x + w * 0.6, y + 14, 6, SMOKE);
    cv.rect(x + w * 0.78, y + 10, 12, 4, INK); cv.line(x + w * 0.78, y + 12, x + w * 0.70, y + 12, INK); cv.line(x + w * 0.90, y + 12, x + w * 0.98, y + 12, INK);
  } else if (id === 3) { // chess in Geneva: board and pieces
    const bs = Math.min(w * 0.5, h * 0.62), bx = x + w * 0.08, by = y + h * 0.08;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 0) cv.rect(bx + c * bs / 8, by + r * bs / 8, bs / 8, bs / 8, INK);
      else cv.rect(bx + c * bs / 8, by + r * bs / 8, bs / 8, bs / 8, LIGHT);
    }
    cv.line(bx, by, bx + bs, by, INK); cv.line(bx, by + bs, bx + bs, by + bs, INK);
    cv.circle(bx + bs * 0.3, by + bs * 0.2, 6, LIGHT); cv.circle(bx + bs * 0.3, by + bs * 0.2, 6, INK);
    cv.circle(bx + bs * 0.3, by + bs * 0.2, 4, LIGHT);
    cv.circle(bx + bs * 0.7, by + bs * 0.75, 6, INK);
    cv.circle(bx + bs * 0.7, by + bs * 0.75, 3.5, LIGHT);
    // two players
    person(cv, bx + bs + w * 0.12, gy - 14, 12, NAVY);
    person(cv, bx + bs + w * 0.24, gy - 14, 12, [120, 40, 40]);
    drawText(cv, x + w * 0.62, y + 6, 'GENEVA', 10, INK, true);
  } else if (id === 4) { // Dymer: damaged apartment block, smoke, rescue
    cv.rect(x + w * 0.1, y + 10, w * 0.3, gy - y - 8, [190, 180, 165]);
    cv.rect(x + w * 0.45, y + 22, w * 0.3, gy - y - 20, [205, 195, 180]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) cv.rect(x + w * 0.13 + c * w * 0.12, y + 16 + r * 14, 8, 8, [90, 100, 120]);
    cv.poly([[x + w * 0.45, y + 22], [x + w * 0.6, y + 34], [x + w * 0.75, y + 22]], [120, 115, 105]); // broken roof
    cv.circle(x + w * 0.58, y + 20, 7, SMOKE); cv.circle(x + w * 0.68, y + 16, 5, SMOKE);
    cv.rect(x + w * 0.1, gy - 4, w * 0.65, 4, INK);
    person(cv, x + w * 0.82, gy - 12, 11, [200, 60, 40]);
    cv.rect(x + w * 0.78, gy - 22, 4, 10, [200, 60, 40]);
  } else if (id === 5) { // Sparta II: cargo ship towed into port
    cv.rect(x + w * 0.08, gy - 18, w * 0.55, 18, [120, 60, 50]);
    cv.rect(x + w * 0.2, gy - 34, w * 0.14, 16, [200, 200, 195]);
    cv.rect(x + w * 0.4, gy - 28, w * 0.1, 10, [200, 200, 195]);
    cv.thick(x + w * 0.3, gy - 34, x + w * 0.3, gy - 46, 2, INK);
    cv.circle(x + w * 0.3, gy - 48, 3, RED);
    cv.rect(x + w * 0.7, gy - 12, w * 0.16, 12, [60, 60, 60]);
    cv.line(x + w * 0.63, gy - 14, x + w * 0.7, gy - 8, INK); // tow line
    cv.line(x + w * 0.1, gy + 8, x + w * 0.3, gy + 8, LIGHT); cv.line(x + w * 0.5, gy + 14, x + w * 0.75, gy + 14, LIGHT);
    drawText(cv, x + w * 0.08, y + 4, 'SPARTA II', 9, INK, true);
  } else if (id === 6) { // markets: chart screen, arrows
    cv.rect(x + w * 0.08, y + 6, w * 0.84, h * 0.6, [30, 40, 55]);
    cv.line(x + w * 0.12, y + h * 0.5, x + w * 0.88, y + h * 0.5, [90, 110, 130]);
    cv.poly([[x + w * 0.12, y + h * 0.2], [x + w * 0.3, y + h * 0.28], [x + w * 0.5, y + h * 0.16], [x + w * 0.7, y + h * 0.42], [x + w * 0.88, y + h * 0.36]], [255, 80, 70]);
    cv.poly([[x + w * 0.12, y + h * 0.45], [x + w * 0.3, y + h * 0.4], [x + w * 0.5, y + h * 0.48], [x + w * 0.7, y + h * 0.52], [x + w * 0.88, y + h * 0.5]], [90, 200, 120]);
    cv.rect(x + w * 0.3, gy + 2, w * 0.4, 4, INK);
    cv.rect(x + w * 0.42, gy + 6, w * 0.16, h * 0.22, INK);
  } else if (id === 7) { // Portugal budget vote: parliament and ballot box
    cv.rect(x + w * 0.12, gy - 30, w * 0.76, 30, [210, 200, 180]);
    cv.poly([[x + w * 0.1, gy - 30], [x + w * 0.5, gy - 52], [x + w * 0.9, gy - 30]], [190, 60, 50]);
    for (let i = 0; i < 4; i++) cv.rect(x + w * 0.18 + i * w * 0.17, gy - 26, 6, 26, INK);
    cv.rect(x + w * 0.62, gy - 14, w * 0.2, 14, NAVY);
    cv.line(x + w * 0.66, gy - 20, x + w * 0.72, gy - 12, INK); cv.line(x + w * 0.72, gy - 12, x + w * 0.8, gy - 24, INK);
  } else if (id === 8) { // Istanbul rally: crowd, banners, dome
    cv.circle(x + w * 0.5, y + 12, 14, [190, 120, 90]); // dome
    cv.rect(x + w * 0.36, y + 26, w * 0.28, 12, [190, 120, 90]);
    cv.thick(x + w * 0.5, y + 2, x + w * 0.5, y + 12, 2, INK);
    cv.rect(x + w * 0.1, gy - 26, w * 0.8, 8, [240, 240, 235]);
    drawText(cv, x + w * 0.16, gy - 24, 'ENOUGH!', 9, RED, true);
    for (let i = 0; i < 7; i++) person(cv, x + w * (0.12 + i * 0.12), gy - 8, 11, [40 + i * 12, 60, 90]);
  } else if (id === 9) { // Seattle airport: terminal, plane, badge
    cv.rect(x + w * 0.08, gy - 26, w * 0.5, 26, [200, 205, 210]);
    for (let i = 0; i < 4; i++) cv.rect(x + w * 0.12 + i * w * 0.11, gy - 20, 8, 10, NAVY);
    cv.poly([[x + w * 0.62, gy - 20], [x + w * 0.95, gy - 20], [x + w * 0.88, gy - 12], [x + w * 0.68, gy - 12]], [240, 240, 240]); // plane body
    cv.poly([[x + w * 0.7, gy - 20], [x + w * 0.74, gy - 32], [x + w * 0.8, gy - 20]], [200, 40, 40]);
    cv.line(x + w * 0.95, gy - 16, x + w * 1.02, gy - 16, INK);
    cv.circle(x + w * 0.14, y + 10, 7, [220, 190, 60]); cv.circle(x + w * 0.14, y + 10, 4, INK);
  } else if (id === 10) { // Hormuz: strait, tankers, warning
    cv.rect(x + w * 0.08, gy - 14, w * 0.34, 14, [150, 70, 60]);
    cv.rect(x + w * 0.56, gy - 18, w * 0.36, 18, [90, 100, 110]);
    cv.thick(x + w * 0.25, gy - 14, x + w * 0.25, gy - 30, 2, INK);
    cv.thick(x + w * 0.72, gy - 18, x + w * 0.72, gy - 36, 2, INK);
    cv.line(x + w * 0.1, gy + 8, x + w * 0.4, gy + 8, LIGHT); cv.line(x + w * 0.55, gy + 14, x + w * 0.9, gy + 14, LIGHT);
    cv.poly([[x + w * 0.46, y + 6], [x + w * 0.54, y + 6], [x + w * 0.5, y + 18]], [255, 200, 40]);
    drawText(cv, x + w * 0.485, y + 8, '!', 9, INK, true);
  } else if (id === 11) { // airspace: jets and radar
    cv.circle(x + w * 0.2, y + h * 0.3, 16, [30, 40, 55]);
    for (let r = 4; r <= 16; r += 4) cv.ring(x + w * 0.2, y + h * 0.3, r, 1, [120, 180, 120]);
    cv.line(x + w * 0.2, y + h * 0.3, x + w * 0.32, y + h * 0.14, [120, 180, 120]);
    cv.poly([[x + w * 0.55, y + 12], [x + w * 0.9, y + 22], [x + w * 0.55, y + 28]], [90, 100, 115]);
    cv.poly([[x + w * 0.62, y + 14], [x + w * 0.68, y + 6], [x + w * 0.72, y + 16]], [90, 100, 115]);
    cv.poly([[x + w * 0.5, y + 40], [x + w * 0.85, y + 50], [x + w * 0.5, y + 56]], [140, 150, 165]);
    cv.line(x + w * 0.55, gy - 8, x + w * 0.9, gy - 8, INK);
  } else if (id === 12) { // Gaza: courthouse columns and scales
    cv.rect(x + w * 0.14, gy - 34, w * 0.72, 6, [190, 180, 165]);
    cv.rect(x + w * 0.14, gy - 6, w * 0.72, 6, [190, 180, 165]);
    for (let i = 0; i < 4; i++) cv.rect(x + w * (0.18 + i * 0.17), gy - 28, 6, 22, [210, 200, 185]);
    cv.poly([[x + w * 0.12, gy - 34], [x + w * 0.5, gy - 52], [x + w * 0.88, gy - 34]], [200, 190, 170]);
    cv.thick(x + w * 0.5, y + 4, x + w * 0.5, y + 16, 1.5, INK);
    cv.line(x + w * 0.42, y + 8, x + w * 0.58, y + 8, INK);
    cv.circle(x + w * 0.43, y + 12, 3, GOLD); cv.circle(x + w * 0.57, y + 12, 3, GOLD);
  } else if (id === 13) { // cricket draw: stumps, bat, ball, scoreboard
    cv.rect(x + w * 0.08, y + 4, w * 0.62, h * 0.5, [50, 60, 70]);
    drawText(cv, x + w * 0.12, y + 10, 'NZ 239/5', 10, LIGHT, true);
    drawText(cv, x + w * 0.12 + textWidth('NZ 239/5 ', 10), y + 10, 'DRAW', 10, [255, 210, 0], true);
    for (let i = 0; i < 3; i++) cv.thick(x + w * (0.62 + i * 0.06), gy - 24, x + w * (0.62 + i * 0.06), gy - 6, 2.5, [240, 220, 150]);
    cv.rect(x + w * 0.62, gy - 26, w * 0.14, 3, [240, 220, 150]);
    cv.poly([[x + w * 0.8, gy - 30], [x + w * 0.88, gy - 30], [x + w * 0.84, gy - 4], [x + w * 0.76, gy - 4]], [200, 170, 110]); // bat
    cv.circle(x + w * 0.93, gy - 12, 5, RED);
    cv.line(x + w * 0.1, gy + 6, x + w * 0.9, gy + 6, [90, 130, 80]);
  }
}

// ---------- content (all first reported Tue 24 Nov 2026) ----------
interface Card { n: number; head: string; body: string; scene: number }
const CARDS: Card[] = [
  { n: 1, head: 'Zelensky calls for four-way talks', body: 'Four parties to meet as soon as possible. "Literally tomorrow," Kyiv says.', scene: 1 },
  { n: 2, head: 'Ukraine strikes deep inside Russia', body: 'Fuel sites hit in Tatarstan, Perm and Rostov. A depot 1,200 km away is struck.', scene: 2 },
  { n: 3, head: 'Chess title defence opens in Geneva', body: 'World champion Gukesh faces challenger Sindarov in the first game of their match.', scene: 3 },
  { n: 4, head: 'Russian strike kills 11 in Dymer', body: 'A drone and missile attack hits a village near Kyiv.', scene: 4 },
  { n: 5, head: 'Damaged Sparta II reaches port', body: 'The Russian cargo ship hit by drones is towed into port.', scene: 5 },
  { n: 6, head: 'Futures climb as Asian tech slides', body: 'US futures rise while big tech shares fall in Asia.', scene: 6 },
  { n: 7, head: 'Portugal votes on its budget', body: 'Unions rally as parliament holds the final budget vote.', scene: 7 },
  { n: 8, head: 'Thousands rally in Istanbul', body: 'Protesters march against the crackdown on the opposition and media.', scene: 8 },
  { n: 9, head: 'Seattle airport slams ICE arrest', body: 'The airport operator condemns the detention of two passengers.', scene: 9 },
  { n: 10, head: 'Hormuz shipping at record level', body: 'Ship attacks in the strait are at their highest since the war.', scene: 10 },
  { n: 11, head: 'Denmark airspace backed by France', body: 'Paris condemns the violation and backs Denmark.', scene: 11 },
  { n: 12, head: 'Gaza executions announced', body: 'A Gaza group says it executed Palestinians accused of aiding Israel.', scene: 12 },
  { n: 13, head: 'India Test ends in a draw', body: 'New Zealand hold on at 239 for 5 in Wellington after a late fightback.', scene: 13 },
];
const BRIEFS: string[] = [
  'UN calls for a probe into ship strikes off Libya',
  'Russia calls the Baltic cargo strike terrorism',
  'Lisbon unions rally again as the budget vote looms',
  'EU sanctions ex-US contractor turned neo-Nazi chief',
  'El Chapo Isidro to face trial in Mexico, not the US',
  'Lebanon slams an IDF visit to a school in its south',
  'UK concert evacuated after unknown substance scare',
  'Melenchon climbs in a French runoff opinion poll',
  'Bolsonaro attacks Brazil courts as politically biased',
  'Schumer warns over Trump backing the Huang return',
  'Trump let slip the Huang return before Nvidia spoke',
  'Modi opens an AI centre at IIT Patna, Rs 400 cr park',
  'India and China hold border talks in Arunachal',
  'Coca-Cola brings back Gold Spot after 26 years',
  'Pilots urge action as the SpiceJet crisis deepens',
  'Food regulator seeks prosecution of Bisleri',
  'Delhi court issues a warrant for Dhruv Rathee',
  'Amit Shah visits Arunachal, stresses self-reliance',
  'Rajya Sabha MP Wadkute dies at AIIMS in Delhi',
  'Modi offers Rs 2 lakh aid after the Kutch accident',
  'India PMI 56.3; oil import bill up 60% to $16bn',
  'India holds third place in the Asia Power Index',
  'HAL says first delayed jets reach the IAF by March',
  'Rupee slips to 92.85 against the US dollar',
];
// regions: Europe 13, Asia 14, North America 4, Middle East 3, Africa 1, South America 1, Oceania 1
const REGIONS: [string, number][] = [['Europe', 13], ['Asia', 14], ['North America', 4], ['Middle East', 3], ['Africa', 1], ['South America', 1], ['Oceania', 1]];
// fields: Politics 15, Conflict 7, Law 6, Business 4, Sport 2, Society 2, Tech 1
const FIELDS: [string, number][] = [['Politics', 15], ['Conflict', 7], ['Law', 6], ['Business', 4], ['Sport', 2], ['Society', 2], ['Tech', 1]];
const NUMBERS: [string, string][] = [
  ['37', 'stories'], ['7', 'regions'], ['11', 'killed in Dymer'], ['1,200 km', 'strike'],
  ['4', 'at the table'], ['3', 'regions hit'], ['56.3', 'India PMI'], ['92.85', 'rupee/$1'],
];
const DATE_CHECK = 'Only stories first reported on Tuesday 24 November 2026 are above. Left out: COP31 ends with no deal (23 Nov) - Nvidia brings back Huang (23 Nov) - CrowdStrike buys Zscaler (23 Nov) - warship sunk off Libya (23 Nov) - Banten fire, 24 dead (21 Nov) - Lisbon march (21 Nov) - Senegal boat, 39 dead (22 Nov).';

// ---------- world map (simplified continents, equirectangular) ----------
const CONTINENTS: number[][][] = [
  // North America
  [[-168, 66], [-140, 70], [-125, 71], [-110, 68], [-95, 69], [-85, 66], [-75, 62], [-65, 60], [-55, 52], [-60, 47], [-70, 44], [-75, 35], [-80, 26], [-85, 20], [-90, 15], [-95, 18], [-105, 22], [-115, 28], [-125, 40], [-125, 49], [-140, 60], [-155, 58], [-165, 60], [-168, 66]],
  // South America
  [[-80, 10], [-70, 12], [-60, 8], [-50, 0], [-40, -5], [-35, -10], [-40, -20], [-48, -28], [-55, -35], [-65, -40], [-70, -50], [-73, -45], [-72, -35], [-75, -20], [-80, -5], [-81, 0], [-80, 10]],
  // Africa
  [[-17, 15], [-10, 30], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [40, 15], [48, 11], [51, 10], [45, 0], [40, -10], [35, -20], [30, -30], [20, -35], [15, -25], [12, -10], [8, 4], [-8, 4], [-17, 15]],
  // Europe
  [[-10, 36], [-9, 43], [-2, 48], [0, 50], [5, 53], [8, 57], [12, 55], [18, 56], [21, 55], [24, 58], [28, 60], [30, 62], [32, 66], [40, 68], [45, 60], [40, 55], [35, 50], [30, 46], [28, 44], [23, 40], [19, 42], [15, 44], [12, 44], [8, 44], [3, 42], [-2, 37], [-10, 36]],
  // Asia
  [[32, 36], [36, 36], [43, 40], [48, 38], [52, 28], [57, 26], [60, 25], [66, 25], [70, 22], [75, 20], [80, 15], [85, 20], [90, 22], [95, 16], [100, 10], [105, 8], [108, 12], [110, 20], [115, 25], [120, 30], [122, 38], [127, 40], [130, 42], [135, 44], [140, 45], [142, 52], [158, 60], [170, 66], [178, 65], [170, 60], [160, 55], [150, 60], [140, 55], [130, 50], [120, 45], [110, 48], [100, 50], [90, 52], [80, 55], [70, 60], [60, 68], [50, 68], [40, 66], [35, 62], [30, 60], [25, 60], [20, 55], [28, 50], [32, 44], [32, 36]],
  // Australia
  [[113, -22], [114, -30], [118, -35], [125, -33], [130, -32], [135, -35], [140, -38], [146, -39], [150, -37], [153, -28], [146, -19], [142, -11], [135, -12], [130, -13], [124, -15], [118, -20], [113, -22]],
];
const PINS: [number, number, number][] = [ // [card, lon, lat] (slightly spread where stories share a city)
  [1, 30, 50], [2, 52, 56], [3, 6, 46], [4, 36, 47], [5, 24, 60],
  [6, 139.7, 35.7], [7, -9.1, 38.7], [8, 29, 41], [9, -122.3, 47.6], [10, 56.5, 26.5],
  [11, 12.6, 55.7], [12, 34.5, 31.5], [13, 174.8, -41.3],
];

// ---------- page layout ----------
function drawCard(cv: Canvas, card: Card, x: number, y: number, w: number, h: number, lead: boolean) {
  cv.rect(x, y, w, h, LIGHT);
  cv.line(x, y, x + w, y, INK); cv.line(x, y + h, x + w, y + h, INK);
  cv.line(x, y, x, y + h, INK); cv.line(x + w, y, x + w, y + h, INK);
  const sceneH = Math.round(h * (lead ? 0.46 : 0.42));
  drawScene(cv, card.scene, x + 1, y + 1, w - 2, sceneH);
  cv.rect(x, y + sceneH + 1, w, 2, RED);
  // number badge
  cv.circle(x + 13, y + sceneH + 15, 8, RED);
  drawText(cv, x + 9, y + sceneH + 8, String(card.n), 11, LIGHT, true);
  const tx = x + 26, tw = w - 34;
  const hs = lead ? 16 : 14;
  const headLines = wrap(card.head, hs, tw).slice(0, 2);
  headLines.forEach((ln, i) => drawText(cv, tx, y + sceneH + 8 + i * hs * 1.25, ln, hs, INK, true));
  const bodyY = y + sceneH + 8 + headLines.length * hs * 1.25 + 2;
  para(cv, tx, bodyY, card.body, lead ? 10.5 : 10, tw, [60, 58, 52], 3);
}

// segmented proportional bar with a two-line legend underneath
function segBar(cv: Canvas, label: string, items: [string, number][], legend: string[], x: number, y: number, w: number) {
  drawText(cv, x, y, label, 11, INK, true);
  const total = items.reduce((a, i) => a + i[1], 0);
  const cols: RGB[] = [NAVY, RED, [60, 120, 70], GOLD, [110, 80, 140], [40, 140, 160], [200, 110, 40]];
  let bx = x;
  items.forEach(([name, v], i) => {
    const sw = w * v / total;
    cv.rect(bx, y + 14, sw, 10, cols[i % cols.length]);
    if (sw >= 26) drawText(cv, bx + sw / 2 - 4, y + 15.5, String(v), 9, LIGHT, true);
    bx += sw;
  });
  legend.forEach((ln, i) => drawText(cv, x, y + 28 + i * 11, ln, 9, GREY));
}

function main() {
  const cv = new Canvas();
  const M = 14, CW = W - 2 * M;

  // masthead
  drawText(cv, M, 6, 'MAKE.FUN DAILY EDITION', 11, GREY, true);
  const dateW = textWidth('TUESDAY 24 NOVEMBER 2026', 12);
  drawText(cv, W - M - dateW, 6, 'TUESDAY 24 NOVEMBER 2026', 12, RED, true);
  const title = 'THE WORLD IN ONE DAY';
  drawText(cv, (W - textWidth(title, 42)) / 2, 20, title, 42, INK, true);
  cv.rect(M, 66, CW, 2, INK);
  const tag = 'Thirty-seven stories from seven regions, checked against the date';
  drawText(cv, (W - textWidth(tag, 12)) / 2, 70, tag, 12, GREY);

  // count strip
  const stripY = 90, stripH = 22;
  cv.rect(M, stripY, CW, stripH, NAVY);
  const counts = '37 STORIES  |  7 REGIONS  |  13 ILLUSTRATED  |  7 FIELDS  |  24 BRIEFS';
  drawText(cv, (W - textWidth(counts, 13)) / 2, stripY + 5, counts, 13, LIGHT, true);

  // lead row: 3 cards
  const leadY = 118, leadH = 146, gap = 8;
  const lw = (CW - 2 * gap) / 3;
  for (let i = 0; i < 3; i++) drawCard(cv, CARDS[i], M + i * (lw + gap), leadY, lw, leadH, true);

  // row 2: 5 cards
  const r2Y = leadY + leadH + gap, rH = 144;
  const cw5 = (CW - 4 * gap) / 5;
  for (let i = 0; i < 5; i++) drawCard(cv, CARDS[3 + i], M + i * (cw5 + gap), r2Y, cw5, rH, false);

  // row 3: 5 cards
  const r3Y = r2Y + rH + gap;
  for (let i = 0; i < 5; i++) drawCard(cv, CARDS[8 + i], M + i * (cw5 + gap), r3Y, cw5, rH, false);

  // briefs: two columns, 12 each
  const brY = r3Y + rH + 8;
  drawText(cv, M, brY, 'THE REST OF THE DAY', 12, INK, true);
  const colW = (CW - 20) / 2, briefY = brY + 18;
  for (let i = 0; i < 24; i++) {
    const col = i < 12 ? 0 : 1, row = i % 12;
    const bx = M + col * (colW + 20), by = briefY + row * 15.5;
    drawText(cv, bx, by, String(14 + i) + '.', 10, RED, true);
    const txt = BRIEFS[i];
    const maxChars = Math.floor((colW - 30) / (10 * 0.66));
    drawText(cv, bx + 26, by, txt.length > maxChars ? txt.slice(0, maxChars - 1) : txt, 10, INK);
  }

  // world map
  const mapY = briefY + 12 * 15.5 + 6, mapH = 104;
  drawText(cv, M, mapY, 'THE WORLD TODAY', 12, INK, true);
  drawText(cv, M + 150, mapY, 'Pins 1 to 13 match the illustrated stories above', 11, GREY);
  const mx = M, my = mapY + 16, mw = CW, mh = mapH - 16;
  cv.rect(mx, my, mw, mh, [222, 234, 240]);
  cv.line(mx, my, mx + mw, my, INK); cv.line(mx, my + mh, mx + mw, my + mh, INK);
  cv.line(mx, my, mx, my + mh, INK); cv.line(mx + mw, my, mx + mw, my + mh, INK);
  const px = (lon: number) => mx + (lon + 180) / 360 * mw;
  const py = (lat: number) => my + (85 - lat) / 145 * mh;
  for (const cont of CONTINENTS) {
    cv.poly(cont.map(([lo, la]) => [px(lo), py(la)]), [150, 165, 145]);
  }
  for (const [n, lo, la] of PINS) {
    const cx = px(lo), cy = py(la);
    cv.circle(cx, cy, 6.5, RED);
    cv.ring(cx, cy, 6.5, 1.2, LIGHT);
    drawText(cv, cx - (n < 10 ? 2 : 4.5), cy - 4, String(n), 8, LIGHT, true);
  }

  // region and field bars, side by side
  const barsY = mapY + mapH + 6, halfW = (CW - 20) / 2;
  segBar(cv, 'REGIONS', REGIONS, ['Europe 13, Asia 14, North America 4, Middle East 3', 'Africa 1, South America 1, Oceania 1'], M, barsY, halfW);
  segBar(cv, 'BY FIELD', FIELDS, ['Politics 15, Conflict 7, Law 6, Business 4', 'Sport 2, Society 2, Tech 1'], M + halfW + 20, barsY, halfW);

  // day in numbers
  const numY = barsY + 54;
  cv.rect(M, numY, CW, 22, INK);
  const nw = CW / NUMBERS.length;
  NUMBERS.forEach(([v, lab], i) => {
    const cx = M + i * nw + nw / 2;
    const s = v + ' ' + lab;
    drawText(cv, cx - textWidth(s, 9.5) / 2, numY + 7, s, 9.5, LIGHT, true);
    if (i) cv.line(M + i * nw, numY + 4, M + i * nw, numY + 18, [120, 120, 120]);
  });

  // date check footer
  const footY = numY + 28;
  cv.rect(M, footY - 4, CW, 1.5, RED);
  drawText(cv, M, footY, 'DATE CHECK', 10, RED, true);
  const lines = wrap(DATE_CHECK, 9, CW - 96);
  lines.slice(0, 2).forEach((ln, i) => drawText(cv, M + 96, footY + i * 11.5, ln, 9, INK));

  // deterministic paper grain (adds newsprint texture and file size)
  const rnd = mulberry32(24112026);
  for (let i = 0; i < W * H; i++) {
    const d = Math.floor((rnd() - 0.5) * 9);
    if (!d) continue;
    for (let k = 0; k < 3; k++) {
      const v = cv.buf[i * 3 + k] + d;
      cv.buf[i * 3 + k] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePng(cv.buf, W, H));
}

main();
