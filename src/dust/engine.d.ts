// Types for the dust engine (engine.js).
export interface Grains {n: number; u: Float32Array; v: Float32Array; r: Uint8Array; g: Uint8Array; b: Uint8Array; a: Uint8Array; s: Float32Array}
export interface DustOptions {renderer?: 'auto' | '2d' | 'webgl'; mode?: 'night' | 'paper'; width?: number; height?: number; max?: number;
  stiffness?: number; damping?: number; current?: number; light?: number; depth?: boolean; streaks?: boolean}
export interface DustEngine {
  renderer: '2d' | 'webgl'; mode: 'night' | 'paper'; readonly count: number; options: Required<DustOptions>;
  emit(id: number, x: number, y: number, size: number, r: number, g: number, b: number, a: number, damping?: number): void;
  step(dt: number, t?: number): void; draw(): void; reset(): void; resize(width: number, height: number): void;
  position(id: number): [number, number] | null;
}
export interface DustScene {end: number; draw(t: number, dt: number, silent?: boolean): void}
export interface DustClock {readonly time: number; readonly playing: boolean; speed: number; play(from?: number): void; skip(): void; stop(): void; seek(at: number, fps?: number): void}
type Paint = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;
export const Dust: {
  create(canvas: HTMLCanvasElement, options?: DustOptions): DustEngine;
  clock(dust: DustEngine, scene: DustScene, options?: {speed?: number; onTime?: (t: number) => void; reducedMotion?: boolean}): DustClock;
  sampleImage(img: CanvasImageSource, n: number, random?: () => number, res?: number): Grains;
  sampleShape(paint: Paint, width: number, height: number, n: number, random?: () => number): Float32Array;
  sampleText(lines: string | string[], font: string, x: number, y: number, lineHeight: number, width: number, height: number, n: number, random?: () => number, align?: CanvasTextAlign): Float32Array;
  travelColour(rgb: number[], p: number, options?: {warm?: number[]; end?: number[] | null; endAt?: number; amount?: number}): number[];
  rng(seed?: number): () => number; daySeed(base?: number): number;
  ease: {inOut(t: number): number; out(t: number): number; in(t: number): number; spring(t: number, k?: number, w?: number): number};
  span(t: number, a: number, b: number): number; mix(a: number, b: number, k: number): number; curve(a: number, b: number, c: number, k: number): number;
  TEMPO: {micro: number; transition: number; moment: number; breath: number};
};
export default Dust;
