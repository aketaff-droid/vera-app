// The dust layer and what starts its moments (docs/DECISIONS.md, section Q): the opening when the window comes
// back, a copy travelling to the Kobo while it is really being sent, books just finished, and Vera dreaming after
// four minutes left alone. The layer never takes a click; any input wakes the dream.
import {useEffect, useLayoutEffect, useRef} from 'react';
import {api, type AppState, type Book} from '../api';
import * as Stage from '../dust/stage';
import * as Vera from '../dust/vera';
import type {Travel} from '../dust/moments';

const AWAY = 10 * 60_000;
// Four minutes; the browser preview can shorten it (`?idle=5`, in seconds) to look at the dream.
const IDLE = (import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('idle')) * 1000 : 0) || 4 * 60_000;
const FINISHED = 'vera.finished';
const isFinished = (b: Book) => !b.problem && (b.kobo?.status === 2 || (b.read !== null && b.read >= .995));

interface Props {
  state: AppState;
  books: Book[];
  /** The library has been read once (so that the opening has covers to gather). */
  ready: boolean;
  /** Nothing else is on screen: no reader, card, dialog or tour (the dream waits for this). */
  calm: boolean;
}

export function DustLayer({state, books, ready, calm}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), veil = useRef<HTMLDivElement>(null), caption = useRef<HTMLDivElement>(null);
  const byHash = useRef(new Map<string, Book>());
  byHash.current = new Map(books.map(b => [b.hash, b]));

  useLayoutEffect(() => {
    if (!canvas.current || !veil.current || !caption.current) return;
    Stage.mount(canvas.current, veil.current, caption.current);
    return () => Stage.unmount();
  }, []);
  // Before the opening below: a layer turned off must never start it.
  useLayoutEffect(() => Stage.setAllowed(state.settings.art), [state.settings.art]);

  // The opening: once the library is there, and again when the window comes back after ten minutes away.
  // Started hidden (in the notification area): it plays the first time the window shows.
  const opened = useRef(false), pending = useRef(false);
  useLayoutEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    if (document.hidden) pending.current = true; else void Vera.opening(byHash.current);
  }, [ready]);
  useEffect(() => {
    let away: number | null = document.hidden ? Date.now() : null;
    const leave = () => {away ??= Date.now();};
    const back = () => {
      if (document.hidden) return;
      const gone = away; away = null;
      if (pending.current) {pending.current = false; void Vera.opening(byHash.current); return;}
      if (gone !== null && Date.now() - gone >= AWAY && document.querySelector('.content [data-book]') && !document.querySelector('.reader, .sheet, .share-layer'))
        void Vera.opening(byHash.current);
    };
    const visibility = () => {if (document.hidden) leave(); else back();};
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    return () => {document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', leave); window.removeEventListener('focus', back);};
  }, []);

  // A copy on its way to the Kobo, following the real transfer; if the Kobo goes, what is in flight turns back.
  const flights = useRef<Travel[]>([]), sent = useRef<string | null>(null), lastFlight = useRef(0);
  const step = state.kobo.step, device = state.kobo.device;
  useEffect(() => {
    if (step?.stage !== 'sending') {sent.current = null; return;}
    const key = `${step.index}/${step.total}/${step.title}`;
    if (sent.current === key || performance.now() - lastFlight.current < 400) return;
    sent.current = key; lastFlight.current = performance.now();
    const book = books.find(b => b.title === step.title);
    void Vera.toKobo(book).then(f => {if (f) flights.current = [...flights.current.slice(-12), f];});
  }, [step, books]);
  useEffect(() => {
    if (device) return;
    for (const f of flights.current) f.interrupt();
    flights.current = [];
  }, [device]);

  // Books finished since last time: remembered on this computer; the first time, nothing is played.
  useEffect(() => {
    if (!ready) return;
    const now = books.filter(isFinished).map(b => b.hash);
    let known: Set<string> | null = null;
    try {const raw = localStorage.getItem(FINISHED); known = raw ? new Set(JSON.parse(raw) as string[]) : null;} catch {known = null;}
    try {localStorage.setItem(FINISHED, JSON.stringify(now));} catch {/* played again next time, at worst */}
    if (!known) return;
    const fresh = books.filter(b => isFinished(b) && !known.has(b.hash));
    if (fresh.length && fresh.length <= 5) setTimeout(() => void Vera.finished(fresh), 600);
  }, [books, ready]);

  // Vera dreams after four minutes alone with the library; any input wakes it.
  const syncing = state.kobo.syncing;
  useEffect(() => {
    if (!calm || syncing || !state.settings.art) return;
    let timer = 0, wake: (() => void) | null = null, cancelled = false;
    const arm = () => {window.clearTimeout(timer); timer = window.setTimeout(sleep, IDLE);};
    const sleep = async () => {
      if (document.hidden || !document.querySelector('.content [data-book]')) {arm(); return;}
      const passages = await api.passages().catch(() => []);
      if (cancelled) return;
      wake = await Vera.dream(byHash.current, passages);
    };
    const input = () => {if (wake) {wake(); wake = null;} arm();};
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, input, {passive: true});
    arm();
    return () => {cancelled = true; window.clearTimeout(timer); wake?.(); for (const e of events) window.removeEventListener(e, input);};
  }, [calm, syncing, state.settings.art]);

  return <>
    <div ref={veil} className="dust-veil" aria-hidden="true"/>
    <canvas ref={canvas} className="dust-overlay" aria-hidden="true"/>
    <div ref={caption} className="dust-caption" aria-hidden="true"/>
  </>;
}
