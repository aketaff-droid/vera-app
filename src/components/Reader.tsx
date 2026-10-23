// Vera's reader, in the spirit of Apple Books: the book alone, a quiet bar, « Aa » for size, background and font.
// EPUBs are laid out by foliate-js, PDFs drawn by pdf.js. The file is only read; the place is kept in Vera's
// catalogue, never on the Kobo. A book's own scripts never run: the window's Content-Security-Policy
// (src-tauri/tauri.conf.json) allows no script but Vera's, and the pages of a book inherit it.
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import {api, type Book, type ReaderSettings, type ReaderTheme, type Settings} from '../api';
import {readerThemes} from '../theme';
import {TitleBar} from './Shell';

interface Mark {label: string; target: string | number; depth: number}
/** What the two engines offer the reader. */
interface Engine {
  next: () => void;
  prev: () => void;
  goTo: (target: string | number) => void;
  goToFraction: (fraction: number) => void;
  style: (settings: ReaderSettings) => void;
  close: () => void;
}
interface Place {fraction: number; chapter: string; position: string}

const percent = (f: number) => `${Math.round(f * 100)} %`;

export function Reader({book, settings, save, close}: {book: Book; settings: Settings; save: (s: Settings) => void; close: () => void}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [toc, setToc] = useState<Mark[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'aa' | 'toc' | null>(null);
  const reader = settings.reader;
  const theme = readerThemes[reader.theme] ?? readerThemes.papier;

  // The place is saved a moment after the page settles, and once more on leaving.
  const last = useRef<Place | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const keep = useCallback((next: Place) => {
    last.current = next;
    setPlace(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void api.saveReading(book.hash, next.position, next.fraction).catch(() => {}), 800);
  }, [book.hash]);
  const leave = useCallback(() => {
    window.clearTimeout(timer.current);
    if (last.current) void api.saveReading(book.hash, last.current.position, last.current.fraction).catch(() => {});
    close();
  }, [book.hash, close]);

  useEffect(() => {
    let cancelled = false;
    const box = host.current;
    if (!box) return;
    (async () => {
      const [bytes, saved] = await Promise.all([api.bookFile(book.hash), api.readingPosition(book.hash).catch(() => null)]);
      if (cancelled) return;
      const open = book.format === 'pdf' ? openPdf : openEpub;
      const opened = await open(box, bytes, saved?.position ?? null, keep, () => cancelled);
      if (cancelled) {opened.engine.close(); return;}
      engine.current = opened.engine;
      opened.engine.style(reader);
      setToc(opened.toc);
    })().catch(e => {if (!cancelled) setError(message(e));});
    return () => {cancelled = true; engine.current?.close(); engine.current = null; box.replaceChildren();};
    // The book is opened once; the settings are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.hash, book.format, keep]);

  useEffect(() => {engine.current?.style(reader);}, [reader]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.key === 'Escape') {e.preventDefault(); if (panel) setPanel(null); else leave(); return;}
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {e.preventDefault(); engine.current?.next();}
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {e.preventDefault(); engine.current?.prev();}
    };
    // The pages of an EPUB are documents of their own: their keys are passed on here (openEpub).
    const relayed = (e: Event) => handle((e as CustomEvent<KeyboardEvent>).detail);
    window.addEventListener('keydown', handle);
    window.addEventListener('vera-reader-key', relayed);
    return () => {window.removeEventListener('keydown', handle); window.removeEventListener('vera-reader-key', relayed);};
  }, [panel, leave]);

  const set = (change: Partial<ReaderSettings>) => save({...settings, reader: {...reader, ...change}});
  // The pages of an EPUB take the reader's colour scheme: a page whose scheme differs from its frame's would get an
  // opaque background of its own.
  const vars = {'--rbg': theme.bg, '--rink': theme.ink, '--rmuted': theme.muted, '--rline': theme.line, '--rpanel': theme.panel,
    colorScheme: theme.dark ? 'dark' : 'light'} as React.CSSProperties;

  return <div className={`reader${theme.dark ? ' dark' : ''}`} style={vars} role="region" aria-label={`Lecture de ${book.title}`}>
    <TitleBar>
      <button className="rbtn" onClick={leave}><Chevron/>Bibliothèque</button>
      {toc.length > 0 && <button className="rbtn" aria-label="Sommaire" aria-expanded={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}><ListIcon/></button>}
      <span className="rtitle" data-tauri-drag-region>{book.title}{book.authors ? ` · ${book.authors}` : ''}</span>
      <button className="rbtn aa-button" aria-label="Apparence de la lecture" aria-expanded={panel === 'aa'} onClick={() => setPanel(panel === 'aa' ? null : 'aa')}>Aa</button>
    </TitleBar>

    {panel === 'aa' && <Popover className="aa" label="Apparence de la lecture" close={() => setPanel(null)}>
      <span className="lab">Taille du texte</span>
      <div className="rowx">
        <button className="seg" aria-label="Texte plus petit" disabled={reader.size <= 14} onClick={() => set({size: reader.size - 1})} style={{fontSize: 13}}>A</button>
        <button className="seg" aria-label="Texte plus grand" disabled={reader.size >= 32} onClick={() => set({size: reader.size + 1})} style={{fontSize: 19}}>A</button>
      </div>
      <span className="lab">Fond</span>
      <div className="rowx" role="radiogroup" aria-label="Fond">
        {(Object.keys(readerThemes) as ReaderTheme[]).map(k => <button key={k} className="sw" role="radio" aria-checked={k === reader.theme} onClick={() => set({theme: k})}>
          <b style={{background: readerThemes[k].bg, color: readerThemes[k].ink}}>Aa</b>{readerThemes[k].name}</button>)}
      </div>
      {book.format === 'epub' && <>
        <span className="lab">Police</span>
        <div className="rowx" role="radiogroup" aria-label="Police">
          <button className="seg" role="radio" aria-checked={reader.font === 'serif'} onClick={() => set({font: 'serif'})} style={{fontFamily: "'Literata Variable', Georgia, serif"}}>Literata</button>
          <button className="seg" role="radio" aria-checked={reader.font === 'sans'} onClick={() => set({font: 'sans'})} style={{fontFamily: 'var(--ui)'}}>Sans</button>
        </div>
      </>}
    </Popover>}

    {panel === 'toc' && <Popover className="toc" label="Sommaire" close={() => setPanel(null)}>
      <span className="lab">Sommaire</span>
      <div className="toc-list">{toc.map((m, i) => <button key={i} className={m.label === place?.chapter ? 'on' : undefined} style={{paddingLeft: 10 + m.depth * 14}}
        onClick={() => {engine.current?.goTo(m.target); setPanel(null);}}>{m.label}</button>)}</div>
    </Popover>}

    <div className="rpage">
      <button className="turn left" aria-label="Page précédente" onClick={() => engine.current?.prev()}><Chevron/></button>
      <div ref={host} className={`rhost ${book.format}`} hidden={!!error}/>
      <button className="turn right" aria-label="Page suivante" onClick={() => engine.current?.next()}><Chevron flip/></button>
      {!place && !error && <p className="rstatus">Ouverture…</p>}
      {error && <div className="rstatus" role="alert"><p>{error}</p><button className="secondary" onClick={leave}>Revenir à la bibliothèque</button></div>}
    </div>

    <div className="rfoot">
      <span className="chapter">{place?.chapter ?? ''}</span>
      <input type="range" min={0} max={1} step={0.001} value={place?.fraction ?? 0} aria-label="Progression dans le livre" disabled={!place}
        onChange={e => engine.current?.goToFraction(Number(e.target.value))} style={{'--p': `${(place?.fraction ?? 0) * 100}%`} as React.CSSProperties}/>
      <span className="pc">{place ? percent(place.fraction) : ''}</span>
    </div>
  </div>;
}

function Popover({className, label, close, children}: {className: string; label: string; close: () => void; children: ReactNode}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!box.current?.contains(target) && !target.closest('[aria-expanded]')) close();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [close]);
  return <div ref={box} className={`rpop ${className}`} role="dialog" aria-label={label}>{children}</div>;
}

const message = (e: unknown) => {
  const text = e instanceof Error ? e.message : String(e);
  if (/encrypt|drm|password/i.test(text)) return 'Ce livre est protégé (DRM ou mot de passe) : il ne peut pas être lu dans Vera.';
  return text.startsWith('Ce ') || text.startsWith('Le ') || text.startsWith('Fichier') || text.startsWith('Livre') ? text : `Ce livre ne peut pas être ouvert dans Vera : ${text}`;
};

/* ——— EPUB, laid out by foliate-js ——— */

type Keep = (place: Place) => void;

async function openEpub(box: HTMLElement, bytes: ArrayBuffer, saved: string | null, keep: Keep, cancelled: () => boolean): Promise<{engine: Engine; toc: Mark[]}> {
  await import('foliate-js/view.js');
  if (cancelled()) throw new Error('Fermé.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = document.createElement('foliate-view') as any;
  box.append(view);
  await view.open(new File([bytes], 'livre.epub', {type: 'application/epub+zip'}));
  const renderer = view.renderer;
  renderer.setAttribute('flow', 'paginated');
  renderer.setAttribute('gap', '6%');
  renderer.setAttribute('margin', '40px');
  renderer.setAttribute('max-inline-size', '680px');
  const columns = () => renderer.setAttribute('max-column-count', box.clientWidth > 1100 ? '2' : '1');
  columns();
  const resize = new ResizeObserver(columns);
  resize.observe(box);

  view.addEventListener('relocate', (e: CustomEvent) => {
    const {fraction, tocItem, cfi} = e.detail;
    if (cfi) keep({fraction: Math.min(1, Math.max(0, fraction ?? 0)), chapter: tocItem?.label?.trim() ?? '', position: cfi});
  });
  // Keys pressed while a page has the focus, and links: an external link never opens from a book.
  view.addEventListener('load', (e: CustomEvent) => {
    e.detail.doc.addEventListener('keydown', (k: KeyboardEvent) => window.dispatchEvent(new CustomEvent('vera-reader-key', {detail: k})));
  });
  view.addEventListener('external-link', (e: Event) => e.preventDefault());

  const flat = (items: {label?: string; href?: string; subitems?: unknown[]}[] | null | undefined, depth = 0): Mark[] =>
    (items ?? []).flatMap(item => [
      ...(item.label && item.href ? [{label: item.label.trim(), target: item.href, depth}] : []),
      ...flat(item.subitems as typeof items, depth + 1),
    ]);
  await view.init({lastLocation: saved, showTextStart: true});

  const font = new URL(literata, location.href).href;
  return {
    toc: flat(view.book.toc),
    engine: {
      next: () => void view.next(),
      prev: () => void view.prev(),
      goTo: target => void view.goTo(target),
      goToFraction: f => void view.goToFraction(f),
      style: settings => renderer.setStyles?.(epubCss(settings, font)),
      close: () => {resize.disconnect(); view.close?.(); view.remove();},
    },
  };
}

function epubCss({size, theme, font}: ReaderSettings, literataUrl: string): string {
  const t = readerThemes[theme] ?? readerThemes.papier;
  const family = font === 'sans' ? "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" : "'Vera Literata', Georgia, serif";
  return `
    @font-face { font-family: 'Vera Literata'; src: url('${literataUrl}') format('woff2'); font-weight: 200 900; font-display: block; }
    html { color-scheme: ${t.dark ? 'dark' : 'light'}; font-size: ${size}px !important; }
    html, body { background: transparent !important; color: ${t.ink} !important; }
    body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${family} !important; }
    ${t.dark ? 'body * { color: inherit !important; background-color: transparent !important; } img { filter: brightness(.85); }' : ''}
    p, li, blockquote, dd { line-height: 1.6; text-align: justify; hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    a:link, a:visited { color: inherit; text-decoration-color: ${t.muted}; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100%; height: auto; }
  `;
}

/* ——— PDF, drawn by pdf.js ——— */

async function openPdf(box: HTMLElement, bytes: ArrayBuffer, saved: string | null, keep: Keep, cancelled: () => boolean): Promise<{engine: Engine; toc: Mark[]}> {
  // The « legacy » build: the modern one relies on JavaScript features WebView2 may not have yet.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const base = new URL('/pdfjs/', location.href).href;
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes), enableXfa: false,
    cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`,
  });
  const doc = await loading.promise;
  if (cancelled()) {void loading.destroy(); throw new Error('Fermé.');}
  const total = doc.numPages;
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-page';
  box.append(canvas);
  let page = Math.min(total, Math.max(1, Number(/^page:(\d+)$/.exec(saved ?? '')?.[1] ?? 1)));
  let drawing: {cancel: () => void} | null = null;

  const outline = await doc.getOutline().catch(() => null);
  const flat = (items: {title: string; dest: unknown; items?: unknown[]}[] | null, depth = 0): Mark[] =>
    (items ?? []).flatMap(item => [{label: item.title.trim(), target: JSON.stringify(item.dest), depth}, ...flat(item.items as typeof items, depth + 1)]);
  const marks = flat(outline);
  // The chapter of a page: the last outline entry that starts at or before it (resolved once, in the background).
  const starts: {label: string; page: number}[] = [];
  void (async () => {
    for (const m of marks) {
      const target = await pageOf(m.target as string).catch(() => null);
      if (target) starts.push({label: m.label, page: target});
    }
    starts.sort((a, b) => a.page - b.page);
  })();
  async function pageOf(dest: string): Promise<number | null> {
    let d = JSON.parse(dest) as unknown;
    if (typeof d === 'string') d = await doc.getDestination(d);
    if (!Array.isArray(d)) return null;
    return (await doc.getPageIndex(d[0])) + 1;
  }

  async function draw() {
    drawing?.cancel();
    const p = await doc.getPage(page);
    const natural = p.getViewport({scale: 1});
    const room = {w: box.clientWidth - 48, h: box.clientHeight - 24};
    const scale = Math.max(0.1, Math.min(room.w / natural.width, room.h / natural.height));
    const ratio = window.devicePixelRatio || 1;
    const viewport = p.getViewport({scale: scale * ratio});
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    const task = p.render({canvas, viewport});
    drawing = task;
    await task.promise.catch(() => {});
    const chapter = [...starts].reverse().find(s => s.page <= page)?.label ?? `Page ${page} sur ${total}`;
    keep({fraction: total > 1 ? (page - 1) / (total - 1) : 1, chapter, position: `page:${page}`});
  }
  const go = (n: number) => {const next = Math.min(total, Math.max(1, n)); if (next !== page) {page = next; void draw();}};
  const resize = new ResizeObserver(() => void draw());
  resize.observe(box);
  await draw();

  return {
    toc: marks,
    engine: {
      next: () => go(page + 1),
      prev: () => go(page - 1),
      goTo: target => void pageOf(String(target)).then(n => {if (n) go(n);}),
      goToFraction: f => go(1 + Math.round(f * (total - 1))),
      // A PDF keeps its own page; the background around it, and a softer page at night, follow the reader.
      style: settings => {canvas.dataset.theme = settings.theme;},
      close: () => {resize.disconnect(); drawing?.cancel(); void loading.destroy(); canvas.remove();},
    },
  };
}

/* ——— Icons ——— */

const Chevron = ({flip = false}: {flip?: boolean}) =>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={flip ? {transform: 'scaleX(-1)'} : undefined}><path d="M10 3L5 8l5 5"/></svg>;
const ListIcon = () =>
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01"/></svg>;
