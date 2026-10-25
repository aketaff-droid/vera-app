// Vera's moments in dust (docs/DECISIONS.md, section Q), as tuned in the prototype « Vera, la poussière de lecture »:
// gather (the opening, a book opening, a book finished), travel (to the Kobo, a share), disperse (a removal) and rest
// (Vera dreams; the reading sky lives in components/Sky.tsx). Each is a function of time that places its grains;
// timings and the twelve refinements come from the « dust-motion » skill (its choreography reference).
import Dust from './engine.js';
import type {Moment} from './stage';
import {WORD_PATH, WORD_VIEWBOX} from '../logo';

const {ease, span, mix, curve} = Dust;
type RGB = [number, number, number];

/** The ink of the current theme, as numbers. */
export function ink(): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(v);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [240, 236, 228];
}

/** A source of dust: a place on screen and, if known, the picture it is made of. */
export interface Source {rect: DOMRect | {x: number; y: number; width: number; height: number}; picture: ImageBitmap | null; tint?: string[]}
interface Cloud {u: Float32Array; v: Float32Array; r: Uint8Array; g: Uint8Array; b: Uint8Array; s: Float32Array}

/** n grains of a source: its picture's pixels, or its colours when the picture is not there. */
function cloud(src: Source, n: number, random: () => number): Cloud {
  if (src.picture) return Dust.sampleImage(src.picture, n, random);
  const tints = (src.tint?.length ? src.tint : ['#8a7d6b', '#3e352c']).map(hex => {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex) ?? ['', '80', '80', '80'];
    return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  });
  const c = {u: new Float32Array(n), v: new Float32Array(n), r: new Uint8Array(n), g: new Uint8Array(n), b: new Uint8Array(n), s: new Float32Array(n)};
  for (let i = 0; i < n; i++) {
    c.u[i] = random(); c.v[i] = random(); c.s[i] = random();
    const t = tints[Math.min(tints.length - 1, Math.floor(c.v[i]! * tints.length))]!, k = .8 + random() * .4;
    c.r[i] = Math.min(255, t[0]! * k); c.g[i] = Math.min(255, t[1]! * k); c.b[i] = Math.min(255, t[2]! * k);
  }
  return c;
}

/* ——— The opening: the dust of your covers gathers into « Vera. », then each grain lands on its book ——— */
export function opening({sources, centre, short, reveal, done}: {
  sources: Source[]; centre: {x: number; y: number}; short: boolean;
  /** Called when the real covers should come back (they are hidden under the dust until then). */
  reveal: () => void; done: () => void;
}): Moment {
  const random = Dust.rng(Dust.daySeed());
  const N = 20000;
  const [vx, vy, vw, vh] = WORD_VIEWBOX.split(' ').map(Number) as [number, number, number, number];
  const ww = Math.min(560, innerWidth * .42), scale = ww / vw, wh = vh * scale;
  const wx = centre.x - ww / 2, wy = centre.y - wh / 2;
  const path = new Path2D(WORD_PATH);
  const word = Dust.sampleShape(o => {o.setTransform(scale, 0, 0, scale, wx - vx * scale, wy - vy * scale); o.fill(path);}, innerWidth, innerHeight, N, random);
  const stopFrom = wx + ww - 44 * (ww / 560);      // the full stop of « Vera. »
  const list = sources.length ? sources : [{rect: {x: centre.x - 60, y: centre.y - 90, width: 120, height: 180}, picture: null} as Source];
  const per = Math.ceil(N / list.length), clouds = list.map(s => cloud(s, per, random));
  const P = new Float32Array(N * 8);   // start x, y, landing x, y, seed, full stop, source, index in its cloud
  for (let i = 0; i < N; i++) {
    const k = Math.min(list.length - 1, Math.floor(i / per)), j = i - k * per, c = clouds[k]!, r = list[k]!.rect;
    const a = random() * Math.PI * 2, d = 40 + Math.pow(random(), .7) * Math.min(470, innerWidth * .4);
    P.set([centre.x + Math.cos(a) * d, centre.y + Math.sin(a) * d * .62, r.x + c.u[j]! * r.width, r.y + c.v[j]! * r.height, c.s[j]! * 1000, word[i * 2]! > stopFrom ? 1 : 0, k, j], i * 8);
  }
  let revealed = false;
  // Real time → the scene's time: a slower gathering, a pause on the finished word to enjoy it, then the landing.
  // Full: 2.9 s to form « Vera. », 1.2 s held, 1.7 s to land (5.8 s). Short: 1.2 s, 0.4 s, 0.8 s (2.4 s).
  const [form, hold, land] = short ? [1.2, .4, .8] : [2.9, 1.2, 1.7];
  const scene = (time: number) => time < form ? time / form * 1.95 : time < form + hold ? 1.95 : 1.95 + Math.min(1, (time - form - hold) / land) * 1.35;
  return {
    end: form + hold + land, grains: N,
    done,
    draw(time, emit, stage) {
      const t = scene(time), inkRGB = ink();
      stage.veil(1 - ease.inOut(span(t, 2.55, 3.15)));
      if (!revealed && t >= 2.7) {revealed = true; reveal();}
      const toWord = ease.inOut(span(t, .55, 1.65)), toLib = ease.inOut(span(t, 2.05, 3.0)), fade = 1 - ease.inOut(span(t, 2.75, 3.3));
      if (fade <= 0) return;
      // The finished word breathes once, slowly, while it is held.
      const breath = Math.sin(span(time, form - .1, form + hold + .15) * Math.PI) * .035;
      for (let i = 0; i < N; i++) {
        const o = i * 8, c = clouds[P[o + 6]!]!, j = P[o + 7]!, s = P[o + 4]!;
        const dx = P[o]! + (centre.x - P[o]!) * t * .12, dy = P[o + 1]! + (centre.y - P[o + 1]!) * t * .12;
        const tw = P[o + 5] ? ease.inOut(span(t, .95, 1.95)) : toWord;
        let x = mix(dx, word[i * 2]!, tw), y = mix(dy, word[i * 2 + 1]!, tw);
        x += (centre.x - x) * breath; y += (centre.y - y) * breath;
        const lag = Math.min(1, Math.max(0, toLib * 1.25 - (s % 1) * .25));
        x += (P[o + 2]! - x) * lag; y += (P[o + 3]! - y) * lag;
        const m = toWord * (1 - lag);
        emit(i, x, y, 1.3 + lag * .8, mix(c.r[j]!, inkRGB[0], m), mix(c.g[j]!, inkRGB[1], m), mix(c.b[j]!, inkRGB[2], m),
          (.55 + .45 * Math.max(toWord, lag)) * fade * Math.min(1, t * 4), P[o + 5] ? .3 : .62);
      }
    },
  };
}

/* ——— Travel: a copy leaves its book and flies to a destination (the Kobo, a person) ——— */
export interface Travel extends Moment {
  /** The transfer stopped (the Kobo unplugged): grains on their way turn back to their book. */
  interrupt(): void;
}
export function travel({source, to, onArrive, warm = true}: {source: Source; to: {x: number; y: number}; onArrive?: () => void; warm?: boolean}): Travel {
  const random = Dust.rng(Math.floor(Math.random() * 1e6) + 1);
  const N = 4200, c = cloud(source, N, random), r = source.rect;
  // The side of the picture nearest the destination leaves first: it unrolls towards where it goes.
  const near = Math.hypot(r.x + r.width / 2 - to.x, r.y + r.height / 2 - to.y) - Math.hypot(r.width, r.height) / 2;
  const delay = new Float32Array(N), spread = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x0 = r.x + c.u[i]! * r.width, y0 = r.y + c.v[i]! * r.height;
    delay[i] = Math.min(1, Math.max(0, (Math.hypot(x0 - to.x, y0 - to.y) - near) / Math.max(120, Math.hypot(r.width, r.height)))) * .42 + c.s[i]! * .13;
    spread[i] = (c.s[i]! - .5) * 160;
  }
  let cut: number | null = null, clock = 0, arrived = false;
  const lightNight: RGB = [255, 214, 160], lightPaper: RGB = [150, 90, 40];
  return {
    end: 1.5, grains: N,
    interrupt() {if (cut === null) cut = clock;},
    draw(t, emit, stage) {
      clock = t;
      if (!arrived && cut === null && t > 1.25) {arrived = true; onArrive?.();}
      const end = ink(), light = stage.night ? lightNight : lightPaper;
      for (let i = 0; i < N; i++) {
        const x0 = r.x + c.u[i]! * r.width, y0 = r.y + c.v[i]! * r.height, d = delay[i]!;
        let p = ease.out(span(t, d, d + .8));
        if (cut !== null) {const back = ease.inOut(span(t, cut, cut + .9)); p = ease.out(span(cut, d, d + .8)) * (1 - back); if (back >= 1) continue;}
        if (p <= 0 || p >= 1) continue;
        const cx = mix(x0, to.x, .45) + spread[i]!, cy = Math.min(y0, to.y) - 40 - c.s[i]! * 120;
        const x = curve(x0, to.x, cx, p), y = curve(y0, to.y, cy, p);
        const k = warm ? Math.sin(p * Math.PI) * .5 : 0, e = span(p, .75, 1) * .6;
        emit(i, x, y, 2.1 * (1 - p * .5), mix(mix(c.r[i]!, light[0], k), end[0], e), mix(mix(c.g[i]!, light[1], k), end[1], e), mix(mix(c.b[i]!, light[2], k), end[2], e),
          Math.min(1, Math.sin(p * Math.PI) * 1.4));
      }
    },
  };
}

/* ——— A book opens: its cover becomes the lines of its first page ——— */
export function openBook({source, page, pageInk}: {source: Source; page: {x: number; y: number; width: number; height: number}; pageInk: RGB}): Moment {
  const random = Dust.rng(17);
  const N = 9000, c = cloud(source, N, random), r = source.rect;
  // Lines of text where the page will be: one or two columns, about 32 px apart, ragged on the right.
  const columns = page.width > 1100 ? 2 : 1, colW = Math.min(620, (page.width - 160) / columns), lines: [number, number, number][] = [];
  for (let col = 0; col < columns; col++) {
    const x0 = page.x + (page.width - columns * colW - (columns - 1) * 60) / 2 + col * (colW + 60);
    for (let y = page.y + 70; y < page.y + page.height - 60; y += 32) lines.push([x0, y, colW * (y % 160 < 20 ? .6 : .9 + random() * .1)]);
  }
  const tx = new Float32Array(N), ty = new Float32Array(N);
  for (let i = 0; i < N; i++) {const l = lines[Math.floor(random() * lines.length)]!; tx[i] = l[0] + random() * l[2]; ty[i] = l[1] + random() * 9;}
  return {
    end: 1.4, grains: N,
    draw(t, emit) {
      const fade = 1 - ease.inOut(span(t, .8, 1.3));
      for (let i = 0; i < N; i++) {
        const p = ease.inOut(span(t, .05 + c.s[i]! * .25, .6 + c.s[i]! * .25));
        const x0 = r.x + c.u[i]! * r.width, y0 = r.y + c.v[i]! * r.height;
        const x = mix(x0, tx[i]!, p) + Math.sin(c.s[i]! * 80 + t * 4) * 10 * Math.sin(p * Math.PI), y = mix(y0, ty[i]!, p);
        emit(i, x, y, 1.4, mix(c.r[i]!, pageInk[0], p), mix(c.g[i]!, pageInk[1], p), mix(c.b[i]!, pageInk[2], p), fade);
      }
    },
  };
}

/* ——— A book finished: its cover condenses into a star of its colour, which rises to the reading sky ——— */
export function finished({source, to, onArrive}: {source: Source; to: {x: number; y: number}; onArrive?: () => void}): Moment {
  const random = Dust.rng(19);
  const N = 6000, c = cloud(source, N, random), r = source.rect;
  // The star takes the cover's most vivid colour.
  let best = 0, vivid: RGB = [255, 220, 170];
  for (let i = 0; i < N; i += 7) {const mx = Math.max(c.r[i]!, c.g[i]!, c.b[i]!), mn = Math.min(c.r[i]!, c.g[i]!, c.b[i]!), v = (mx - mn) * mx; if (v > best) {best = v; vivid = [c.r[i]!, c.g[i]!, c.b[i]!];}}
  const cx0 = r.x + r.width / 2, cy0 = r.y + r.height / 2;
  let arrived = false;
  return {
    end: 3.1, grains: N,
    draw(t, emit) {
      if (!arrived && t > 2.95) {arrived = true; onArrive?.();}
      const pinch = 1 - .04 * Math.sin(span(t, .1, .32) * Math.PI);
      const cond = ease.inOut(span(t, .3, 1.4)), rise = ease.inOut(span(t, 1.5, 2.9));
      const sx = curve(cx0, to.x, Math.min(cx0, to.x) + (to.x - cx0) * .2 - 80, rise), sy = curve(cy0, to.y, Math.min(cy0, to.y) - 120, rise);
      for (let i = 0; i < N; i++) {
        const p = ease.inOut(span(cond, c.s[i]! * .3, .7 + c.s[i]! * .3));
        const x0 = cx0 + (c.u[i]! - .5) * r.width * pinch, y0 = cy0 + (c.v[i]! - .5) * r.height * pinch, a = c.s[i]! * 40 + t * 3 * p;
        const ring = 30 * Math.sin(p * Math.PI) + 3 * p;
        const x = mix(x0, sx, p) + Math.cos(a) * ring, y = mix(y0, sy, p) + Math.sin(a) * ring;
        emit(i, x, y, 1.5, mix(c.r[i]!, vivid[0], p), mix(c.g[i]!, vivid[1], p), mix(c.b[i]!, vivid[2], p), .9 * (1 - span(t, 2.85, 3.1)));
      }
    },
  };
}

/* ——— A removal: what leaves scatters in a breath of wind (only after the owner's click) ——— */
export function disperse({rects, colour}: {rects: DOMRect[]; colour: RGB}): Moment {
  const random = Dust.rng(23);
  const N = Math.min(9000, 2500 * rects.length), u = new Float32Array(N), v = new Float32Array(N), s = new Float32Array(N), k = new Uint8Array(N);
  for (let i = 0; i < N; i++) {k[i] = i % rects.length; u[i] = random(); v[i] = random(); s[i] = random();}
  return {
    end: 1.9, grains: N,
    draw(t, emit) {
      for (let i = 0; i < N; i++) {
        const r = rects[k[i]!]!, start = u[i]! * .45 + s[i]! * .25, p = span(t, start, start + 1.2);
        const pinch = 1 - .035 * Math.sin(span(t, 0, .18) * Math.PI);
        const x0 = r.x + r.width / 2 + (u[i]! - .5) * r.width * pinch, y0 = r.y + r.height / 2 + (v[i]! - .5) * r.height * pinch;
        const x = x0 + p * p * (260 + s[i]! * 220), y = y0 - p * (40 + s[i]! * 90) + Math.sin(s[i]! * 50 + t * 5) * 12 * p;
        emit(i, x, y, 1.4 * (1 - p * .5), colour[0], colour[1], colour[2], p > 0 ? (1 - p) * .9 : .5);
      }
    },
  };
}

/* ——— Vera dreams: the library dissolves into a slow drift, and passages the owner highlighted form in it ——— */
export interface Dream extends Moment {wake(): void}
export function dream({sources, passages, font}: {sources: Source[]; passages: {text: string; title: string; authors: string}[]; font: string}): Dream {
  const random = Dust.rng(31);
  const N = 9000, list = sources.length ? sources : [{rect: {x: innerWidth / 2 - 60, y: innerHeight / 2 - 90, width: 120, height: 180}, picture: null} as Source];
  const per = Math.ceil(N / list.length), clouds = list.map(s => cloud(s, per, random));
  const cx = innerWidth / 2, cy = innerHeight / 2;
  // Each passage is set in lines of about 30 characters, and stays long enough to be read.
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const shown = passages.slice(0, 8).map(p => {
    const words = p.text.split(' '), lines: string[] = []; let line = '';
    for (const w of words) {const next = line ? `${line} ${w}` : w; if (measure.measureText(next).width > Math.min(640, innerWidth * .6) && line) {lines.push(line); line = w;} else line = next;}
    lines.push(line);
    const lh = 54, top = cy - (lines.length - 1) * lh / 2 + 14;
    return {lines, caption: `${p.authors ? p.authors + ', ' : ''}${p.title}`, length: 2.4 + words.length * .34 + 1.4,
      target: Dust.sampleText(lines, font, cx, top, lh, innerWidth, innerHeight, N, random, 'center')};
  });
  const total = shown.reduce((a, q) => a + q.length, 0);
  let woke: number | null = null, clock = 0;
  return {
    end: Infinity, grains: N,
    wake() {if (woke === null) woke = clock;},
    draw(t, emit, stage) {
      clock = t;
      if (woke !== null && t > woke + 1.1) return;        // awake: the grains are home, let them fade
      const wake = woke === null ? 0 : ease.inOut(span(t, woke, woke + .9));
      const sleep = ease.inOut(span(t, .2, 3)) * (1 - wake);
      stage.veil(sleep * .97);
      const inkRGB = ink(), breath = 1 + .07 * Math.sin(t * Math.PI * 2 * .1);
      let q: (typeof shown)[number] | null = null, phase = 0;
      if (shown.length && t > 3) {let local = (t - 3) % total, k = 0; while (local >= shown[k]!.length) {local -= shown[k]!.length; k++;} q = shown[k]!; phase = local / q.length;}
      const form = q ? ease.inOut(span(phase, .05, .3)) * (1 - ease.inOut(span(phase, .78, 1))) * (1 - wake) : 0;
      if (q) stage.caption(q.caption, span(phase, .28, .38) * (1 - span(phase, .72, .8)) * sleep);
      for (let i = 0; i < N; i++) {
        const k = Math.min(list.length - 1, Math.floor(i / per)), j = i - k * per, c = clouds[k]!, r = list[k]!.rect, s = c.s[j]!;
        // Each grain drifts on its own slow orbit: its place on the cover sets the angle, its seed the distance.
        const bx = r.x + c.u[j]! * r.width, by = r.y + c.v[j]! * r.height, a = (c.u[j]! * 7 + c.v[j]! * 13) * Math.PI + t * (.04 + s * .09);
        const d = Math.sqrt((s * 7.31) % 1);
        const fx = cx + Math.cos(a) * (60 + d * innerWidth * .42) * breath, fy = cy + Math.sin(a + s * 2) * (40 + d * innerHeight * .36) * breath;
        const loose = ease.inOut(span(t, .3 + s * 1.5, 2 + s * 1.5)) * (1 - wake);
        let x = mix(bx, fx, loose), y = mix(by, fy, loose);
        if (q) {x = mix(x, q.target[i * 2]!, form); y = mix(y, q.target[i * 2 + 1]!, form);}
        emit(i, x, y, 1.3, mix(c.r[j]!, inkRGB[0], form * .85), mix(c.g[j]!, inkRGB[1], form * .85), mix(c.b[j]!, inkRGB[2], form * .85), (.5 + .45 * form) * Math.max(sleep, .15 * (1 - wake)));
      }
    },
  };
}
