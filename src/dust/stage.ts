// The dust stage (docs/DECISIONS.md, section Q): one transparent layer over the whole window where Vera's moments
// play — the opening, a copy travelling to the Kobo, a book opening, a book finished, a removal, a dream. Each moment
// only says, for its time t, where its grains want to be; the engine gives them a body (springs, mass, a current,
// depth, light at night, ink on paper). Several moments can play at once; nothing runs when none does, nor while the
// window is hidden. The whole layer is off when the owner turns « Animations artistiques » off or Windows asks for
// fewer animations.
import Dust, {type DustEngine} from './engine.js';
import {api} from '../api';

/** What a moment gives the stage. Times are in seconds since it started. */
export interface Moment {
  /** How long it lasts; Infinity for a moment that rests until it is stopped. */
  end: number;
  /** How many grains it may emit (ids 0 … grains − 1, its own range). */
  grains: number;
  draw(t: number, emit: Emit, stage: StageInfo): void;
  /** Called once when it is over (after the grains have settled). */
  done?(): void;
}
export type Emit = (id: number, x: number, y: number, size: number, r: number, g: number, b: number, a: number, damping?: number) => void;
export interface StageInfo {width: number; height: number; night: boolean; veil(alpha: number): void; caption(text: string, alpha: number): void}
export interface Playing {stop(): void; readonly over: boolean}

const SETTLE = 1.4;
let canvas: HTMLCanvasElement | null = null, veilEl: HTMLDivElement | null = null, captionEl: HTMLElement | null = null, dust: DustEngine | null = null;
let raf = 0, last = 0, allowed = true;
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
interface Active {m: Moment; t0: number; base: number; stopped: number | null; over: boolean}
let active: Active[] = [];

/** The layer: called once by DustLayer with its canvas and veil. */
export function mount(c: HTMLCanvasElement, veil: HTMLDivElement, caption: HTMLElement) {
  canvas = c; veilEl = veil; captionEl = caption;
  try {
    dust = Dust.create(c, {renderer: 'auto', width: innerWidth, height: innerHeight, max: 80000, mode: night() ? 'night' : 'paper'});
  } catch {dust = null;}
  addEventListener('resize', () => dust?.resize(innerWidth, innerHeight));
}
export function unmount() {cancelAnimationFrame(raf); active = []; dust?.reset(); canvas = null; veilEl = null; dust = null;}

/** Whether moments play at all: the owner's setting, and Windows' « fewer animations ». */
export function setAllowed(on: boolean) {allowed = on; if (!on) stopAll();}
export const enabled = () => allowed && !reduce && !!dust;
/** Whether a moment is playing now. */
export const busy = () => active.length > 0;
const night = () => document.documentElement.classList.contains('md-dark');

/** Starts a moment; does nothing (and calls done at once) when the dust is off. */
export function play(m: Moment): Playing {
  if (!enabled() || !dust) {m.done?.(); return {stop() {}, over: true};}
  dust.mode = night() ? 'night' : 'paper';
  // Each moment has its own range of grain ids, so that moments playing together never share a grain.
  let base = 0;
  for (const a of [...active].sort((x, y) => x.base - y.base)) {if (base + m.grains <= a.base) break; base = Math.max(base, a.base + a.m.grains);}
  if (base + m.grains > dust.options.max) {m.done?.(); return {stop() {}, over: true};}
  const entry: Active = {m, t0: performance.now(), base, stopped: null, over: false};
  active.push(entry);
  if (!raf) {last = performance.now(); raf = requestAnimationFrame(frame);}
  return {stop() {if (entry.stopped === null) entry.stopped = (performance.now() - entry.t0) / 1000;}, get over() {return entry.over;}};
}
export function stopAll() {for (const a of active) a.stopped ??= (performance.now() - a.t0) / 1000;}

function frame(now: number) {
  if (!dust) {raf = 0; return;}
  if (document.hidden) {last = now; raf = requestAnimationFrame(frame); return;}
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  let veil = 0, caption = '', captionAlpha = 0;
  const info: StageInfo = {width: innerWidth, height: innerHeight, night: night(), veil: a => {veil = Math.max(veil, a);}, caption: (text, a) => {if (a > captionAlpha) {caption = text; captionAlpha = a;}}};
  const keep: Active[] = [];
  for (const a of active) {
    const t = (now - a.t0) / 1000;
    const ends = Math.min(a.m.end, a.stopped ?? Infinity);
    // A stopped or finished moment stops emitting: its grains keep their momentum and fade.
    if (t <= ends) a.m.draw(t, (id, x, y, s, r, g, b, al, z) => {if (id >= 0 && id < a.m.grains) dust!.emit(a.base + id, x, y, s, r, g, b, al, z);}, info);
    if (t > ends + SETTLE) {a.over = true; a.m.done?.(); continue;}
    keep.push(a);
  }
  active = keep;
  if (veilEl) veilEl.style.opacity = String(veil);
  if (captionEl) {if (captionEl.textContent !== caption) captionEl.textContent = caption; captionEl.style.opacity = String(captionAlpha);}
  dust.step(dt, now / 1000); dust.draw();
  if (active.length || dust.count) raf = requestAnimationFrame(frame);
  else {raf = 0; dust.reset(); if (veilEl) veilEl.style.opacity = '0'; if (captionEl) captionEl.style.opacity = '0';}
}

/* ——— What the dust is made of ——— */

const pictures = new Map<string, Promise<ImageBitmap | null>>();
/** A book's thumbnail as pixels the page may read (asked from Vera as bytes). Cached. */
export function picture(hash: string): Promise<ImageBitmap | null> {
  let p = pictures.get(hash);
  if (!p) {
    p = api.coverThumb(hash).then(bytes => createImageBitmap(new Blob([bytes]))).catch(() => null);
    pictures.set(hash, p);
  }
  return p;
}
/** Pictures of several books, waiting at most `ms` (a moment never waits long for its material). */
export async function picturesOf(hashes: string[], ms = 700): Promise<Map<string, ImageBitmap>> {
  const out = new Map<string, ImageBitmap>();
  await Promise.race([
    Promise.all(hashes.map(async h => {const p = await picture(h); if (p) out.set(h, p);})),
    new Promise(r => setTimeout(r, ms)),
  ]);
  return out;
}

/** Where an element is, if it is on screen. */
export function onScreen(el: Element | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null;
}
/** A book's cover on screen (its tile in the library), if visible. */
export const coverOf = (hash: string) => onScreen(document.querySelector(`[data-book="${CSS.escape(hash)}"] .cover`));
