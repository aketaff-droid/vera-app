// The reading sky (docs/DECISIONS.md, section Q): each finished book is a star of its cover's colour, placed by the
// month the Kobo last saw it read and by its collection; the books of a collection are joined into a constellation.
// The book being read is a cloud of its cover, gathered as far as it has been read. Hovering names a star; a click
// opens its card. It breathes slowly, and keeps still when Windows asks for fewer animations.
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Book} from '../api';
import Dust from '../dust/engine.js';
import {picture} from '../dust/stage';
import {plural} from '../format';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const done = (b: Book) => !b.problem && (b.kobo?.status === 2 || (b.read !== null && b.read >= .995));
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const monthOf = (b: Book) => {const d = b.kobo?.lastRead ? new Date(b.kobo.lastRead) : null; return d && !isNaN(d.getTime()) ? d.getFullYear() * 12 + d.getMonth() : null;};
const hex = (s: string | undefined): [number, number, number] => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(s ?? '') ?? ['', 'f0', 'd8', 'b0'];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
};

interface Star {book: Book; x: number; y: number; r: number; ph: number; rgb: [number, number, number]; band: string; when: string}

export function Sky({books, open}: {books: Book[]; open: (hash: string) => void}) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({w: 0, h: 0});
  const [near, setNear] = useState<Star | null>(null);
  const pointer = useRef<{x: number; y: number} | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({w: el.clientWidth, h: el.clientHeight}));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finished = useMemo(() => books.filter(done), [books]);
  const current = useMemo(() => books.filter(b => !b.problem && (b.kobo?.status === 1 || (b.read !== null && b.read > 0 && b.read < .995) && b.kobo?.status !== 2))
    .sort((a, b) => (b.kobo?.lastRead ?? '').localeCompare(a.kobo?.lastRead ?? ''))[0] ?? null, [books]);

  // Columns: the months from the first dated book to now (two years at most); undated books go to the right.
  const layout = useMemo(() => {
    const now = new Date(), last = now.getFullYear() * 12 + now.getMonth();
    const dated = finished.map(monthOf).filter((m): m is number => m !== null);
    const first = Math.max(last - 23, Math.min(last - 5, ...dated));
    const columns = last - first + 1 + (finished.some(b => monthOf(b) === null) ? 1 : 0);
    const bands = [...new Set(finished.map(b => b.collection?.split(' › ')[0] ?? 'Hors collection'))].slice(0, 6);
    return {first, last, columns, bands};
  }, [finished]);

  const stars = useMemo<Star[]>(() => {
    const {w, h} = size;
    if (!w) return [];
    const random = Dust.rng(29);
    const left = 70, right = current ? Math.min(320, w * .32) : 50, top = 70, bottom = 70;
    const cw = (w - left - right) / Math.max(1, layout.columns), bh = (h - top - bottom) / Math.max(1, layout.bands.length);
    return finished.map(book => {
      const m = monthOf(book), band = book.collection?.split(' › ')[0] ?? 'Hors collection';
      const col = m === null ? layout.columns - 1 : Math.max(0, m - layout.first);
      const row = Math.max(0, layout.bands.indexOf(band)) ;
      return {book, band, x: left + (col + .5) * cw + (random() - .5) * cw * .6, y: top + (row + .5) * bh + (random() - .5) * bh * .55,
        r: 3.4 + random() * 2.8, ph: random() * 6, rgb: hex(book.tint[0]), when: m === null ? 'fini' : `fini en ${MONTHS[m % 12]} ${Math.floor(m / 12)}`};
    }).sort((a, b) => a.x - b.x);
  }, [finished, size, layout, current]);

  // The book being read, as dust: its picture sampled once.
  const cloud = useRef<ReturnType<typeof Dust.sampleImage> | null>(null);
  const [sampled, setSampled] = useState(0);
  useEffect(() => {
    cloud.current = null;
    if (!current) return;
    let live = true;
    void picture(current.hash).then(p => {if (live && p) {cloud.current = Dust.sampleImage(p, 5000, Dust.rng(7)); setSampled(n => n + 1);}});
    return () => {live = false;};
  }, [current]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = size.w * dpr; c.height = size.h * dpr;
    const ctx = c.getContext('2d')!;
    const random = Dust.rng(3);
    const motes = Array.from({length: 500}, () => [random() * size.w, random() * size.h, random(), random() * 6] as const);
    const read = current ? (current.kobo?.status === 1 ? current.kobo.percent / 100 : current.read ?? 0) : 0;
    const C = {w: 110, h: 165, x: size.w - Math.min(320, size.w * .32) / 2 - 55, y: size.h / 2 - 110};
    let raf = 0;
    const draw = (ms: number) => {
      const t = reduce ? 0 : ms / 1000, style = getComputedStyle(document.documentElement);
      const night = document.documentElement.classList.contains('md-dark');
      const ink = hex(style.getPropertyValue('--ink').trim()), soft = style.getPropertyValue('--muted').trim() || '#888';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      for (const [x, y, s, ph] of motes) {
        ctx.fillStyle = `rgba(${ink.join(',')},${.05 + .08 * (.5 + .5 * Math.sin(t * 1.4 + ph))})`;
        ctx.fillRect((x + t * 4 * s) % size.w, y, 1, 1);
      }
      // Months along the bottom.
      ctx.font = '500 10px system-ui, sans-serif'; ctx.fillStyle = soft; ctx.globalAlpha = .75;
      const left = 70, right = current ? Math.min(320, size.w * .32) : 50, cw = (size.w - left - right) / Math.max(1, layout.columns);
      for (let i = 0; i < layout.columns; i++) {
        const m = layout.first + i, undated = m > layout.last;
        if (!undated && layout.columns > 14 && i % 2) continue;
        ctx.fillText(undated ? 'sans date' : m % 12 === 0 || i === 0 ? `${MONTHS[m % 12]} ${Math.floor(m / 12)}` : MONTHS[m % 12]!, left + i * cw + cw / 2 - 12, size.h - 28);
      }
      ctx.globalAlpha = 1;
      const px = pointer.current && !reduce ? pointer.current.x - size.w / 2 : 0, py = pointer.current && !reduce ? pointer.current.y - size.h / 2 : 0;
      const at = (s: Star) => ({x: s.x + px * s.r * .003, y: s.y + py * s.r * .003});
      // Constellations: a collection's books joined in reading order.
      ctx.lineWidth = 1; ctx.strokeStyle = night ? 'rgba(255,214,160,.16)' : 'rgba(80,60,40,.16)';
      ctx.font = 'italic 400 13px "Instrument Serif", Georgia, serif';
      for (const band of layout.bands) {
        const list = stars.filter(s => s.band === band);
        if (!list.length) continue;
        ctx.beginPath(); list.forEach((s, i) => {const p = at(s); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);}); ctx.stroke();
        const p = at(list[0]!); ctx.fillStyle = soft; ctx.globalAlpha = .8; ctx.fillText(band, p.x - 4, p.y - 16); ctx.globalAlpha = 1;
      }
      const breath = reduce ? 1 : .86 + .14 * Math.sin(t * Math.PI * 2 * .1);
      ctx.globalCompositeOperation = night ? 'lighter' : 'multiply';
      for (const s of stars) {
        const p = at(s), r = s.r * (.75 + .25 * Math.sin(t * 2 + s.ph));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        g.addColorStop(0, `rgba(${s.rgb.join(',')},${.95 * breath})`); g.addColorStop(.25, `rgba(${s.rgb.join(',')},${.35 * breath})`); g.addColorStop(1, `rgba(${s.rgb.join(',')},0)`);
        ctx.fillStyle = g; ctx.fillRect(p.x - r * 5, p.y - r * 5, r * 10, r * 10);
        ctx.fillStyle = night ? `rgba(255,255,255,${.9 * breath})` : `rgba(${s.rgb.join(',')},${breath})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * .45, 0, 7); ctx.fill();
      }
      // The book being read: gathered in proportion to its reading, the rest circling it.
      const g = cloud.current;
      if (g) for (let i = 0; i < g.u.length; i++) {
        const s = g.s[i]!, gathered = s < read, a = (g.u[i]! * 7 + g.v[i]! * 13) * Math.PI + t * (.12 + s * .25), rr = 40 + Math.sqrt((s * 7.31) % 1) * 90;
        const x = gathered ? C.x + g.u[i]! * C.w + Math.sin(t * 2 + i) * .4 : C.x + C.w / 2 + Math.cos(a) * rr * 1.2;
        const y = gathered ? C.y + g.v[i]! * C.h : C.y + C.h / 2 + Math.sin(a) * rr;
        ctx.fillStyle = `rgba(${g.r[i]},${g.g[i]},${g.b[i]},${gathered ? .95 : .4})`;
        ctx.fillRect(x, y, gathered ? 1.5 : 1.1, gathered ? 1.5 : 1.1);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, stars, layout, current, sampled]);

  const move = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    pointer.current = {x, y};
    let best: Star | null = null, d = 22;
    for (const s of stars) {const k = Math.hypot(s.x - x, s.y - y); if (k < d) {d = k; best = s;}}
    setNear(best);
  };
  const read = current ? (current.kobo?.status === 1 ? current.kobo.percent : Math.round((current.read ?? 0) * 100)) : 0;

  return <div className="sky" ref={host} onPointerMove={move} onPointerLeave={() => {pointer.current = null; setNear(null);}}
    onClick={() => near && open(near.book.hash)} style={{cursor: near ? 'pointer' : undefined}}>
    <canvas ref={canvas} aria-hidden="true" style={{width: size.w, height: size.h}}/>
    <p className="sky-sub">{finished.length ? plural(finished.length, 'livre terminé', 'livres terminés') : 'Aucun livre terminé pour l’instant'}{current ? ' · 1 en cours' : ''}</p>
    {!finished.length && <p className="sky-empty">Chaque livre que tu finis sur ta Kobo ou dans Vera deviendra une étoile ici, de la couleur de sa couverture.</p>}
    {current && <div className="sky-current" style={{left: size.w - Math.min(320, size.w * .32) / 2 - 55, top: size.h / 2 + 70}}>
      <b>{current.title}</b><span>En cours · {read} %</span></div>}
    {near && <div className="sky-tip" style={{left: Math.min(size.w - 220, near.x + 14), top: Math.max(8, near.y - 56)}} role="tooltip">
      <b>{near.book.title}</b><span>{near.book.authors ? `${near.book.authors} · ` : ''}{near.when}</span></div>}
    {/* For screen readers and the keyboard, the sky is also a list. */}
    <ul className="sr-only">{finished.map(b => <li key={b.hash}><button onClick={() => open(b.hash)}>{b.title}{b.authors ? `, ${b.authors}` : ''}</button></li>)}</ul>
  </div>;
}
