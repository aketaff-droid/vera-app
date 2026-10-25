// Vera's reader, in the spirit of Apple Books: the book alone, a quiet bar, « Aa » for size, background and font, and
// a zoom (a PDF's page, an EPUB's text; Ctrl + molette, Ctrl +/−/0).
// EPUBs are laid out by foliate-js, PDFs drawn by pdf.js. The file is only read; the place is kept in Vera's
// catalogue, never on the Kobo. A book's own scripts never run: the window's Content-Security-Policy
// (src-tauri/tauri.conf.json) allows no script but Vera's, and the pages of a book inherit it.
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import {api, type Book, type Highlight, type HighlightColor, type ReaderSettings, type ReaderTheme, type Settings} from '../api';
import {readerThemes} from '../theme';
import {TitleBar} from './Shell';
import {enabled as artful} from '../dust/stage';

interface Mark {label: string; target: string | number; depth: number}
/** What the two engines offer the reader. */
interface Engine {
  next: () => void;
  prev: () => void;
  goTo: (target: string | number) => void;
  goToFraction: (fraction: number) => void;
  style: (settings: ReaderSettings) => void;
  /** PDF only: the page's scale over « whole page » (1). */
  zoom?: (level: number) => void;
  /** EPUB only: the highlights drawn on the pages. */
  marks?: (list: Highlight[]) => void;
  clearSelection?: () => void;
  close: () => void;
}
interface Place {fraction: number; chapter: string; position: string}

const percent = (f: number) => `${Math.round(f * 100)} %`;
/** Highlight colours, as drawn on the page (at the reader's opacity) and in the menus. */
const COLORS: Record<HighlightColor, {name: string; fill: string}> = {
  jaune: {name: 'Jaune', fill: '#F2C230'}, vert: {name: 'Vert', fill: '#5DBB63'}, bleu: {name: 'Bleu', fill: '#4A9BE0'}, rose: {name: 'Rose', fill: '#E8659A'},
};
/** Text chosen on a page, or a highlight touched, with where to show its menu (window coordinates). */
export interface Chosen {position: string; text: string; x: number; y: number}
interface Hooks {chose: (c: Chosen | null) => void; touched: (position: string, x: number, y: number) => void}

/** The zoom steps of a PDF page, 1 being the whole page in the window. */
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
/** An EPUB zooms its text: the reader's text size, from 14 to 32 (19 by default, shown as 100 %). */
const TEXT = {min: 14, max: 32, base: 19, step: 2};

export function Reader({book, settings, save, close}: {book: Book; settings: Settings; save: (s: Settings) => void; close: () => void}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [toc, setToc] = useState<Mark[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'aa' | 'toc' | 'marks' | null>(null);
  const [zoom, setZoom] = useState(1);
  // The page comes into focus as the dust of the cover settles into it.
  const [focusIn, setFocusIn] = useState(artful);
  useEffect(() => {const t = setTimeout(() => setFocusIn(false), 1300); return () => clearTimeout(t);}, []);
  // Highlights: kept in Vera's catalogue, never in the book's file nor on the Kobo.
  const [marks, setMarks] = useState<Highlight[]>([]);
  const [menu, setMenu] = useState<{chosen?: Chosen; mark?: Highlight; x: number; y: number; note?: boolean} | null>(null);
  const hooks = useRef<Hooks>({chose: () => {}, touched: () => {}});
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
      const opened = book.format === 'pdf' ? await openPdf(box, bytes, saved?.position ?? null, keep, () => cancelled)
        : await openEpub(box, bytes, saved?.position ?? null, keep, () => cancelled, hooks.current);
      if (cancelled) {opened.engine.close(); return;}
      engine.current = opened.engine;
      opened.engine.style(reader);
      setToc(opened.toc);
      if (book.format === 'epub') {
        const list = await api.highlights(book.hash).catch(() => []);
        if (!cancelled) {setMarks(list); opened.engine.marks?.(list);}
      }
    })().catch(e => {if (!cancelled) setError(message(e));});
    return () => {cancelled = true; engine.current?.close(); engine.current = null; box.replaceChildren();};
    // The book is opened once; the settings are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.hash, book.format, keep]);

  useEffect(() => {engine.current?.style(reader);}, [reader]);
  useEffect(() => {engine.current?.zoom?.(zoom);}, [zoom]);

  // Choosing text opens the colours; touching a highlight opens its menu (colour, note, removal).
  hooks.current.chose = c => setMenu(c ? {chosen: c, x: c.x, y: c.y} : null);
  hooks.current.touched = (position, x, y) => {
    const mark = marks.find(m => m.position === position);
    if (mark) setMenu({mark, x, y});
  };
  const store = async (next: Highlight[]) => {setMarks(next); engine.current?.marks?.(next);};
  const paint = async (color: HighlightColor) => {
    if (menu?.chosen) {
      const h: Highlight = {id: crypto.randomUUID(), position: menu.chosen.position, text: menu.chosen.text.slice(0, 20000), color, note: '', fraction: place?.fraction ?? 0, created: 0};
      const saved = await api.saveHighlight(book.hash, h).catch(() => null);
      engine.current?.clearSelection?.();
      if (saved) {await store([...marks, saved].sort((a, b) => a.fraction - b.fraction)); setMenu({mark: saved, x: menu.x, y: menu.y});}
    } else if (menu?.mark) {
      const saved = await api.saveHighlight(book.hash, {...menu.mark, color}).catch(() => null);
      if (saved) {await store(marks.map(m => m.id === saved.id ? saved : m)); setMenu({...menu, mark: saved});}
    }
  };
  const annotate = async (note: string) => {
    if (!menu?.mark) return;
    const saved = await api.saveHighlight(book.hash, {...menu.mark, note}).catch(() => null);
    if (saved) {await store(marks.map(m => m.id === saved.id ? saved : m)); setMenu(null);}
  };
  const unmark = async (mark: Highlight) => {
    await api.deleteHighlight(book.hash, mark.id).catch(() => {});
    await store(marks.filter(m => m.id !== mark.id));
    setMenu(null);
  };
  const [exported, setExported] = useState<string | null>(null);

  const pdf = book.format === 'pdf';
  const set = useCallback((change: Partial<ReaderSettings>) => save({...settings, reader: {...reader, ...change}}), [save, settings, reader]);
  // One zoom for both kinds of book: the page of a PDF, the text of an EPUB.
  const zoomBy = useCallback((direction: 1 | -1 | 0) => {
    if (pdf) {
      setZoom(z => direction === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) + direction))] ?? 1);
    } else {
      const size = direction === 0 ? TEXT.base : Math.min(TEXT.max, Math.max(TEXT.min, reader.size + direction * TEXT.step));
      if (size !== reader.size) set({size});
    }
  }, [pdf, reader.size, set]);
  const zoomLabel = pdf ? `${Math.round(zoom * 100)} %` : `${Math.round(reader.size / TEXT.base * 100)} %`;
  const canIn = pdf ? zoom < ZOOMS[ZOOMS.length - 1]! : reader.size < TEXT.max;
  const canOut = pdf ? zoom > 1 : reader.size > TEXT.min;

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.key === 'Escape') {e.preventDefault(); if (menu) {setMenu(null); engine.current?.clearSelection?.();} else if (panel) setPanel(null); else leave(); return;}
      if (e.ctrlKey && ['+', '=', 'Add'].includes(e.key)) {e.preventDefault(); zoomBy(1); return;}
      if (e.ctrlKey && ['-', '_', 'Subtract'].includes(e.key)) {e.preventDefault(); zoomBy(-1); return;}
      if (e.ctrlKey && e.key === '0') {e.preventDefault(); zoomBy(0); return;}
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {e.preventDefault(); engine.current?.next();}
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {e.preventDefault(); engine.current?.prev();}
    };
    // The pages of an EPUB are documents of their own: their keys are passed on here (openEpub).
    const relayed = (e: Event) => handle((e as CustomEvent<KeyboardEvent>).detail);
    window.addEventListener('keydown', handle);
    window.addEventListener('vera-reader-key', relayed);
    return () => {window.removeEventListener('keydown', handle); window.removeEventListener('vera-reader-key', relayed);};
  }, [panel, leave, zoomBy, menu]);

  // Ctrl + molette zooms, as everywhere in Windows (the wheel alone still scrolls a zoomed page).
  useEffect(() => {
    const box = host.current;
    if (!box) return;
    let last = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.timeStamp - last < 120) return;
      last = e.timeStamp;
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    box.addEventListener('wheel', wheel, {passive: false});
    return () => box.removeEventListener('wheel', wheel);
  }, [zoomBy]);
  // The pages of an EPUB take the reader's colour scheme: a page whose scheme differs from its frame's would get an
  // opaque background of its own.
  const vars = {'--rbg': theme.bg, '--rink': theme.ink, '--rmuted': theme.muted, '--rline': theme.line, '--rpanel': theme.panel,
    colorScheme: theme.dark ? 'dark' : 'light'} as React.CSSProperties;

  return <div className={`reader${theme.dark ? ' dark' : ''}${focusIn ? ' focus-in' : ''}`} style={vars} role="region" aria-label={`Lecture de ${book.title}`}>
    <TitleBar>
      <button className="rbtn" onClick={leave}><Chevron/>Bibliothèque</button>
      {toc.length > 0 && <button className="rbtn" aria-label="Sommaire" aria-expanded={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}><ListIcon/></button>}
      <span className="rtitle" data-tauri-drag-region>{book.title}{book.authors ? ` · ${book.authors}` : ''}</span>
      {!pdf && <button className="rbtn" aria-label="Surlignages" aria-expanded={panel === 'marks'} onClick={() => setPanel(panel === 'marks' ? null : 'marks')}>
        <Marker/>{marks.length > 0 && <span className="rcount">{marks.length}</span>}</button>}
      <span className="rzoom" role="group" aria-label="Zoom">
        <button className="rbtn" aria-label={pdf ? 'Dézoomer' : 'Texte plus petit'} title="Ctrl −" disabled={!canOut} onClick={() => zoomBy(-1)}><Minus/></button>
        <button className="rbtn zl" aria-label="Taille normale" title="Ctrl 0" onClick={() => zoomBy(0)}>{zoomLabel}</button>
        <button className="rbtn" aria-label={pdf ? 'Zoomer' : 'Texte plus grand'} title="Ctrl +" disabled={!canIn} onClick={() => zoomBy(1)}><Plus/></button>
      </span>
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

    {panel === 'marks' && <Popover className="marks" label="Surlignages" close={() => setPanel(null)}>
      <span className="lab">Surlignages</span>
      {marks.length === 0 ? <p className="rempty">Sélectionne un passage du livre pour le surligner.</p>
        : <div className="toc-list">{marks.map(m => <button key={m.id} className="mark-row" onClick={() => {engine.current?.goTo(m.position); setPanel(null);}}>
          <i style={{background: COLORS[m.color].fill}} aria-hidden="true"/><span><q>{m.text.length > 140 ? m.text.slice(0, 140) + '…' : m.text}</q>
          {m.note && <small className="mine">{m.note}</small>}<small>{Math.round(m.fraction * 100)} %</small></span></button>)}</div>}
      {marks.length > 0 && <button className="seg" onClick={() => void api.exportAnnotations(book.hash, book.title, book.authors).then(p => setExported(p ? `Enregistré : ${p}` : null)).catch(e => setExported((e as Error).message))}>Exporter les surlignages…</button>}
      {exported && <p className="rempty" role="status">{exported}</p>}
    </Popover>}

    {menu && <div className="hl-menu" role="dialog" aria-label={menu.mark ? 'Surlignage' : 'Surligner'}
      style={{left: Math.min(Math.max(12, menu.x - 130), window.innerWidth - 272), top: Math.max(52, menu.y - (menu.note ? 150 : 58))}}>
      {menu.note && menu.mark ? <NoteField initial={menu.mark.note} save={note => void annotate(note)} cancel={() => setMenu({...menu, note: false})}/> : <>
        {(Object.keys(COLORS) as HighlightColor[]).map(c => <button key={c} className="hl-dot" aria-label={`Surligner en ${COLORS[c].name.toLowerCase()}`} aria-pressed={menu.mark?.color === c}
          style={{background: COLORS[c].fill}} onClick={() => void paint(c)}/>)}
        {menu.mark && <><span className="hl-sep"/>
          <button className="hl-act" onClick={() => setMenu({...menu, note: true})}>{menu.mark.note ? 'Note' : 'Ajouter une note'}</button>
          <button className="hl-act" aria-label="Retirer le surlignage" onClick={() => void unmark(menu.mark!)}>Retirer</button></>}
      </>}
    </div>}

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

function NoteField({initial, save, cancel}: {initial: string; save: (note: string) => void; cancel: () => void}) {
  const [text, setText] = useState(initial);
  return <div className="hl-note">
    <textarea autoFocus value={text} maxLength={20000} onChange={e => setText(e.target.value)} placeholder="Ta note sur ce passage" aria-label="Note"
      onKeyDown={e => {e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(text); if (e.key === 'Escape') cancel();}}/>
    <span><button className="hl-act" onClick={cancel}>Annuler</button><button className="hl-act strong" onClick={() => save(text)}>Enregistrer</button></span>
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

async function openEpub(box: HTMLElement, bytes: ArrayBuffer, saved: string | null, keep: Keep, cancelled: () => boolean, hooks: Hooks): Promise<{engine: Engine; toc: Mark[]}> {
  await import('foliate-js/view.js');
  const {Overlayer} = await import('foliate-js/overlayer.js');
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
  // Where something in a page is, in the window: the page is a frame of its own.
  const onWindow = (doc: Document, rect: DOMRect) => {
    const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
    return {x: (frame?.left ?? 0) + rect.left + rect.width / 2, y: (frame?.top ?? 0) + rect.top};
  };
  // Keys pressed while a page has the focus, text chosen on it, and links: an external link never opens from a book.
  view.addEventListener('load', (e: CustomEvent) => {
    const {doc, index} = e.detail as {doc: Document; index: number};
    doc.addEventListener('keydown', (k: KeyboardEvent) => window.dispatchEvent(new CustomEvent('vera-reader-key', {detail: k})));
    doc.addEventListener('pointerup', () => setTimeout(() => {
      const selection = doc.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!selection || selection.isCollapsed || !text) {hooks.chose(null); return;}
      const range = selection.getRangeAt(0);
      hooks.chose({position: view.getCFI(index, range), text, ...onWindow(doc, range.getBoundingClientRect())});
    }, 10));
  });
  // Highlights: drawn by foliate-js on each page as it is laid out; a touch on one opens its menu.
  let current: Highlight[] = [];
  // A new highlight is laid down like ink along its lines, once (docs/DECISIONS.md, section Q).
  const fresh = new Set<string>();
  let primed = false;
  view.addEventListener('draw-annotation', (e: CustomEvent) => {
    const {draw, annotation} = e.detail;
    const ink = fresh.delete(annotation.value);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    draw((rects: any, options: any) => {
      const g: SVGGElement = Overlayer.highlight(rects, options);
      if (ink) [...g.children].forEach((rect, i) => Object.assign((rect as SVGElement).style, {transformBox: 'fill-box', transformOrigin: 'left center'}) && (rect as SVGElement).animate(
        [{transform: 'scaleX(0)', opacity: .35}, {transform: 'scaleX(1)', opacity: 1}],
        {duration: 420, delay: i * 140, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'backwards'}));
      return g;
    }, {color: COLORS[annotation.color as HighlightColor]?.fill ?? COLORS.jaune.fill});
  });
  // A page's overlay is attached just after this event: its highlights are added once it is there.
  view.addEventListener('create-overlay', () => setTimeout(() => {for (const h of current) void view.addAnnotation({value: h.position, color: h.color});}));
  view.addEventListener('show-annotation', (e: CustomEvent) => {
    const {value, range} = e.detail as {value: string; range: Range};
    const doc = range.startContainer.ownerDocument;
    if (doc) {const at = onWindow(doc, range.getBoundingClientRect()); hooks.touched(value, at.x, at.y);}
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
      marks: list => {
        for (const h of current) if (!list.some(n => n.position === h.position && n.color === h.color)) void view.deleteAnnotation({value: h.position});
        for (const h of list) if (!current.some(o => o.position === h.position && o.color === h.color)) {
          if (primed && artful() && !current.some(o => o.position === h.position)) fresh.add(h.position);
          void view.addAnnotation({value: h.position, color: h.color});
        }
        current = list;
        primed = true;
      },
      clearSelection: () => {for (const {doc} of view.renderer.getContents?.() ?? []) doc?.getSelection?.()?.removeAllRanges();},
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
  let zoom = 1;

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
    const scale = Math.max(0.1, Math.min(room.w / natural.width, room.h / natural.height)) * zoom;
    // Keep the middle of what is seen in the middle when the scale changes.
    const middle = {x: (box.scrollLeft + box.clientWidth / 2) / Math.max(1, box.scrollWidth), y: (box.scrollTop + box.clientHeight / 2) / Math.max(1, box.scrollHeight)};
    const ratio = window.devicePixelRatio || 1;
    const viewport = p.getViewport({scale: scale * ratio});
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    box.classList.toggle('zoomed', zoom > 1);
    if (zoom > 1) {box.scrollLeft = middle.x * box.scrollWidth - box.clientWidth / 2; box.scrollTop = middle.y * box.scrollHeight - box.clientHeight / 2;}
    const task = p.render({canvas, viewport});
    drawing = task;
    await task.promise.catch(() => {});
    const chapter = [...starts].reverse().find(s => s.page <= page)?.label ?? `Page ${page} sur ${total}`;
    keep({fraction: total > 1 ? (page - 1) / (total - 1) : 1, chapter, position: `page:${page}`});
  }
  const go = (n: number) => {const next = Math.min(total, Math.max(1, n)); if (next !== page) {page = next; box.scrollTop = 0; void draw();}};
  // A zoomed page is moved by dragging it, as a picture.
  let drag: {x: number; y: number; left: number; top: number} | null = null;
  const down = (e: PointerEvent) => {if (zoom > 1 && e.button === 0) {drag = {x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop}; box.setPointerCapture(e.pointerId); box.classList.add('dragging');}};
  const move = (e: PointerEvent) => {if (drag) {box.scrollLeft = drag.left - (e.clientX - drag.x); box.scrollTop = drag.top - (e.clientY - drag.y);}};
  const up = () => {drag = null; box.classList.remove('dragging');};
  box.addEventListener('pointerdown', down);
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
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
      zoom: level => {if (level !== zoom) {zoom = level; void draw();}},
      close: () => {
        resize.disconnect(); drawing?.cancel(); void loading.destroy(); canvas.remove(); box.classList.remove('zoomed');
        box.removeEventListener('pointerdown', down); box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
      },
    },
  };
}

/* ——— Icons ——— */

const Chevron = ({flip = false}: {flip?: boolean}) =>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={flip ? {transform: 'scaleX(-1)'} : undefined}><path d="M10 3L5 8l5 5"/></svg>;
const Minus = () =>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3.5 8h9"/></svg>;
const Plus = () =>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9"/></svg>;
const Marker = () =>
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.5 3.5l4 4-7.5 7.5H5v-4z"/><path d="M3 17.5h14"/></svg>;
const ListIcon = () =>
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01"/></svg>;
