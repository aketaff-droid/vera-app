import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {api, listen, type AppState, type Book, type FolderState, type KoboState, type Library, type Settings as S} from './api';
import {matches, sorted, type Sort} from './format';
import {applyTheme, onSystemAppearance} from './theme';
import {sameView, Sidebar, TitleBar, type View} from './components/Shell';
import {CollectionCards, Empty, FolderAlert, Group, Hero, KoboCapsule, SortMenu, Toolbar, type Marks} from './components/Library';
import {AuthorList, authorsIn} from './components/Authors';
import {Twins} from './components/Twins';
import {Journal} from './components/Journal';
import {Share} from './components/Share';
import {Remove} from './components/Remove';
import {plural, size} from './format';

// The reader and its engines (foliate-js, pdf.js) load only when a book is opened.
const Reader = lazy(() => import('./components/Reader').then(m => ({default: m.Reader})));
import {Sheet} from './components/Sheet';
import {Settings} from './components/Settings';
import {Onboarding} from './components/Onboarding';
import {Tour} from './components/Tour';

const ROOT = 'Hors collection';

/** Per-viewer convenience only: the sort survives a restart when the browser storage allows it. */
function savedSort(): Sort {
  try {
    const value = localStorage.getItem('vera.sort');
    return value === 'title' || value === 'author' ? value : 'recent';
  } catch {return 'recent';}
}

/** The book tiles on screen, for the arrow keys. */
const tiles = () => [...document.querySelectorAll<HTMLElement>('.content [data-book]')];

/** The nearest tile in the direction of the arrow, as on a grid of covers. */
function neighbour(from: HTMLElement, key: string): HTMLElement | null {
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null, score = Infinity;
  for (const tile of tiles()) {
    if (tile === from) continue;
    const b = tile.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    const ok = key === 'ArrowRight' ? dx > 4 && Math.abs(dy) < a.height / 2
      : key === 'ArrowLeft' ? dx < -4 && Math.abs(dy) < a.height / 2
      : key === 'ArrowDown' ? dy > 4 : dy < -4;
    if (!ok) continue;
    const d = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dx) : Math.abs(dy) * 4 + Math.abs(dx);
    if (d < score) {score = d; best = tile;}
  }
  // Right at the end of a row goes on to the next one, as reading does.
  if (!best && (key === 'ArrowRight' || key === 'ArrowLeft')) {
    const all = tiles();
    best = all[all.indexOf(from) + (key === 'ArrowRight' ? 1 : -1)] ?? null;
  }
  return best;
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [library, setLibrary] = useState<Library>({books: [], collections: [], twins: []});
  const [sort, setSort] = useState<Sort>(savedSort);
  const [history, setHistory] = useState<View[]>([{kind: 'all'}]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  // Choosing books to share: the selection, then the assistant with the chosen books.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // The guided start: once after the first start (and after the update that brought it), then from the settings.
  const [touring, setTouring] = useState(false);
  const [sharing, setSharing] = useState<string[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [glow, setGlow] = useState(false);
  const [toast, setToast] = useState<{text: string; undo?: () => void} | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const view = history[history.length - 1] ?? {kind: 'all'};

  const lastKobo = useRef<KoboState | null>(null);
  const refresh = useCallback(() => {
    void api.state().then(s => {lastKobo.current = s.kobo; setState(s);}).catch(e => setFailure(e.message));
    void api.library().then(setLibrary).catch(e => setFailure(e.message));
  }, []);

  useEffect(() => {
    refresh();
    const offs = [
      listen('library', refresh),
      listen<FolderState>('folder', folder => setState(s => s && {...s, folder})),
      listen<KoboState>('kobo', kobo => {
        const before = lastKobo.current;
        lastKobo.current = kobo;
        setState(s => s && {...s, kobo});
        // A synchronisation that has just ended: the light sweeps once across the banner.
        if (before?.syncing && !kobo.syncing && kobo.report) {
          setGlow(true);
          setTimeout(() => setGlow(false), 1800);
          void api.state().then(setState);
        }
      }),
      listen<S>('settings', settings => setState(s => s && {...s, settings})),
      listen<AppState['update']>('update', update => setState(s => s && {...s, update})),
      listen('show-update', () => go({kind: 'settings'})),
    ];
    return () => offs.forEach(off => off());
  }, [refresh]);

  const accent = state?.settings.accent ?? 'orange';
  const theme = state?.settings.theme ?? 'vera';
  const appearance = state?.settings.appearance ?? 'auto';
  useEffect(() => {applyTheme(theme, accent, appearance); return onSystemAppearance(() => applyTheme(theme, accent, appearance));}, [theme, accent, appearance]);
  // Reflet: the window's colours come from the book being read (on the Kobo or in Vera), else the newest one.
  const mood = useMemo(() => {
    const books = library?.books ?? [];
    const reading = books.find(b => b.kobo?.status === 1) ?? books.find(b => b.read !== null && b.read < 1)
      ?? [...books].sort((a, b) => b.addedAt - a.addedAt)[0];
    return reading?.tint ?? [];
  }, [library]);
  useEffect(() => {
    const root = document.documentElement.style;
    if (mood[0]) root.setProperty('--mood', mood[0]); else root.removeProperty('--mood');
    if (mood[1]) root.setProperty('--mood2', mood[1]); else root.removeProperty('--mood2');
  }, [mood]);

  const go = useCallback((next: View) => {
    setOpen(null); setQuery('');
    setHistory(h => sameView(h[h.length - 1] ?? {kind: 'all'}, next) ? h : [...h.slice(-20), next]);
  }, []);
  const back = useCallback(() => {
    if (open) {setOpen(null); return;}
    setHistory(h => h.length > 1 ? h.slice(0, -1) : h);
  }, [open]);
  useEffect(() => {
    // Mouse button 4 and Alt+← go back: the card first, then the previous view.
    const mouse = (e: MouseEvent) => {if (e.button === 3) {e.preventDefault(); back();}};
    const key = (e: KeyboardEvent) => {if (e.altKey && e.key === 'ArrowLeft') back();};
    window.addEventListener('mouseup', mouse);
    window.addEventListener('keydown', key);
    return () => {window.removeEventListener('mouseup', mouse); window.removeEventListener('keydown', key);};
  }, [back]);

  const chooseSort = useCallback((next: Sort) => {
    setSort(next);
    try {localStorage.setItem('vera.sort', next);} catch {/* the sort is simply not remembered */}
  }, []);

  useEffect(() => {
    // Typing finds a book, the arrows walk the covers, Entrée opens one, Échap clears the search.
    const key = (e: KeyboardEvent) => {
      if (open || reading || sharing || reviewing || e.defaultPrevented || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      const search = document.getElementById('search') as HTMLInputElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (e.ctrlKey && e.key === ',') {e.preventDefault(); go({kind: 'settings'}); return;}
      if (e.ctrlKey && e.key.toLowerCase() === 'f' && search) {e.preventDefault(); search.focus(); search.select(); return;}
      if (e.ctrlKey) return;
      if (typing) {
        if (e.key === 'Escape' && target === search) {setQuery(''); search?.blur();}
        if (e.key === 'ArrowDown' && target === search) {e.preventDefault(); tiles()[0]?.focus();}
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const from = target.closest<HTMLElement>('[data-book]');
        const next = from ? neighbour(from, e.key) : tiles()[0];
        if (next) {e.preventDefault(); next.focus(); next.scrollIntoView({block: 'nearest'});}
        return;
      }
      if (e.key === 'Escape' && query) {setQuery(''); return;}
      if (search && e.key.length === 1 && /\S/.test(e.key) && !(target instanceof HTMLButtonElement && e.key === ' ')) {
        e.preventDefault();
        search.focus();
        setQuery(q => q + e.key);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, reading, sharing, reviewing, query, go]);

  const save = useCallback(async (settings: S) => {
    const saved = await api.saveSettings(settings);
    setState(s => s && {...s, settings: saved});
    refresh();
  }, [refresh]);
  const changeFolder = useCallback(async () => {
    const path = await api.chooseFolder().catch(() => null);
    if (path && state) await save({...state.settings, watchDir: path}).catch(e => setToast({text: e.message}));
  }, [state, save]);
  const eject = useCallback(() => void api.eject().catch(e => setToast({text: e.message})), []);
  const retry = useCallback(() => void api.syncNow().catch(e => setToast({text: e.message})), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const marks: Marks = useMemo(() => {
    const report = state?.kobo.report;
    return {
      waiting: new Set(state?.deviceKnown ? state.waiting : []),
      sent: new Set(report ? report.results.filter(r => r.outcome === 'copied' || r.outcome === 'updated').map(r => r.hash) : []),
      selected: selected ?? undefined,
    };
  }, [state, selected]);

  if (failure && !state) return <div className="center"><p className="note warn">{failure}</p></div>;
  if (!state) return null;
  if (!state.settings.onboarded) return <div className="app"><div className="ambient"/><main><TitleBar/><Onboarding state={state} library={library} save={save}/></main></div>;

  const books = sorted(library.books.filter(b => !query || matches(query, b.title, b.authors)), sort);
  const authors = authorsIn(library.books);
  const sortMenu = <SortMenu value={sort} onChange={chooseSort}/>;
  const groupsOf = (list: Book[], names: (string | null)[]) => names.map(name => ({name: name ?? ROOT, books: list.filter(b => b.collection === name)})).filter(g => g.books.length);
  const setAppearance = (a: S['appearance']) => void save({...state.settings, appearance: a});
  const openBook = (hash: string) => {
    if (!selected) {setOpen(hash); return;}
    const next = new Set(selected);
    if (next.has(hash)) next.delete(hash); else next.add(hash);
    setSelected(next);
  };
  const selectButton = <button data-tour="select" className={`pill${selected ? ' on' : ''}`} onClick={() => {setSelected(selected ? null : new Set()); setOpen(null);}}>
    {selected ? 'Terminer' : 'Sélectionner'}</button>;
  const dir = state.settings.watchDir ?? '';
  const readingBook = reading ? library.books.find(b => b.hash === reading) ?? null : null;

  // The books the current view shows, for « Tout sélectionner » (a collection: all its books, its sub-collections too).
  const shownBooks = view.kind === 'collection' ? books.filter(b => b.collection === view.name || b.collection?.startsWith(`${view.name} › `))
    : view.kind === 'author' ? books.filter(b => authorsIn([b]).some(a => a.name === view.name)) : books;
  let body: ReactNode;
  if (view.kind === 'settings') {
    body = <><Toolbar title="Réglages" appearance={appearance} setAppearance={setAppearance}/>
      <Settings state={state} library={library} save={s => save(s).catch(e => setToast({text: e.message}))} changeFolder={() => void changeFolder()} journal={() => go({kind: 'journal'})} tour={() => {go({kind: 'all'}); setTouring(true);}}/></>;
  } else if (view.kind === 'journal') {
    body = <><Toolbar title="Journal" crumb="Réglages" onCrumb={() => go({kind: 'settings'})} appearance={appearance} setAppearance={setAppearance}/>
      <Journal/></>;
  } else if (view.kind === 'authors') {
    const shown = authors.filter(a => !query || matches(query, a.name));
    body = <><Toolbar title="Auteurs" query={query} setQuery={setQuery} appearance={appearance} setAppearance={setAppearance}/>
      <AuthorList authors={shown} go={name => go({kind: 'author', name})}/></>;
  } else if (view.kind === 'author') {
    const author = authors.find(a => a.name === view.name);
    body = <><Toolbar title={view.name} crumb="Auteurs" onCrumb={() => go({kind: 'authors'})} appearance={appearance} setAppearance={setAppearance}>{selectButton}{sortMenu}</Toolbar>
      {author ? <Group name="Livres" books={sorted(author.books, sort === 'author' ? 'title' : sort)} marks={marks} open={openBook}/>
        : <p className="note">Plus aucun livre de cet auteur dans ton dossier.</p>}</>;
  } else if (view.kind === 'collections') {
    body = <><Toolbar title="Collections" appearance={appearance} setAppearance={setAppearance}/>
      <CollectionCards collections={library.collections.filter(c => c.parent === null)} books={library.books} go={name => go({kind: 'collection', name})}/>
      {!library.collections.length && <p className="note" style={{fontSize: 15}}>Aucune collection : range tes livres dans des sous-dossiers de {dir}, ils deviendront des collections ici et des étagères sur la Kobo.</p>}
      {groupsOf(library.books, [null]).map(g => <Group key={g.name} name={g.name} books={g.books} marks={marks} open={openBook}/>)}</>;
  } else if (view.kind === 'collection') {
    const c = library.collections.find(x => x.name === view.name);
    const subs = library.collections.filter(x => x.parent === view.name);
    const parent = c?.parent ?? null;
    const direct = books.filter(b => b.collection === view.name);
    const inSubs = books.filter(b => b.collection?.startsWith(`${view.name} › `));
    body = <><Toolbar title={c?.label ?? view.name} crumb={parent ? parent.split(' › ').pop() : 'Collections'}
      onCrumb={() => go(parent ? {kind: 'collection', name: parent} : {kind: 'collections'})} query={query} setQuery={setQuery} appearance={appearance} setAppearance={setAppearance}>{selectButton}{sortMenu}</Toolbar>
      {!query && <CollectionCards collections={subs} books={library.books} go={name => go({kind: 'collection', name})}/>}
      {direct.length > 0 && <Group name={subs.length ? `Dans « ${c?.label ?? view.name} »` : 'Livres'} books={direct} marks={marks} open={openBook}/>}
      {query && groupsOf(inSubs, [...new Set(inSubs.map(b => b.collection))]).map(g => <Group key={g.name} name={g.name} books={g.books} marks={marks} open={openBook}/>)}
      {!c && <p className="note">Cette collection n’existe plus : son dossier a été vidé ou renommé.</p>}</>;
  } else {
    const names = [null, ...library.collections.map(c => c.name)];
    const groups = groupsOf(books, names);
    body = <><Toolbar title="Bibliothèque" query={query} setQuery={setQuery} appearance={appearance} setAppearance={setAppearance}>{selectButton}{sortMenu}</Toolbar>
      {state.folder.error && <FolderAlert dir={dir} retry={() => void save(state.settings)} change={() => void changeFolder()}/>}
      {!query && !selected && library.books.length > 0 && <Hero state={state} books={library.books} marks={marks} open={openBook}/>}
      {!query && <Twins groups={library.twins} books={library.books} open={openBook} dismissed={refresh}/>}
      {groups.map(g => <Group key={g.name} name={g.name} books={g.books} marks={marks} open={openBook}/>)}
      {query && !groups.length && <p className="note" style={{fontSize: 15}}>Aucun livre ne correspond à « {query} ».</p>}
      {!library.books.length && !state.folder.error && !state.folder.reading && <Empty dir={dir} open={() => void api.openFolder()}/>}</>;
  }
  return <div className="app">
    <div className="ambient"/>
    <Sidebar state={state} library={library} authors={authors.length} view={view} go={go} eject={eject}/>
    <main>
      <TitleBar/>
      <div className="content">{body}</div>
      {selected ? <SelectBar count={selected.size} bytes={library.books.filter(b => selected.has(b.hash)).reduce((s, b) => s + b.size, 0)}
        all={() => setSelected(new Set([...selected, ...shownBooks.filter(b => !b.problem).map(b => b.hash)]))} allCount={shownBooks.filter(b => !b.problem).length}
        share={() => setSharing([...selected])}/>
        : <KoboCapsule state={state} library={library} glow={glow} eject={eject} retry={retry} review={() => setReviewing(true)}/>}
    </main>
    {(touring || !state.settings.toured) && view.kind === 'all' && !open && !reading && !sharing && !selected &&
      <Tour close={() => {setTouring(false); if (!state.settings.toured) void save({...state.settings, toured: true});}}/>}
    {open && <Sheet hash={open} onKobo={state.deviceKnown && !marks.waiting.has(open)} replaceEdited={state.settings.replaceEdited}
      close={() => setOpen(null)} saved={undo => setToast({text: 'Fiche enregistrée', undo})} read={() => {setReading(open); setOpen(null);}}
      share={() => {setSharing([open]); setOpen(null);}}/>}
    {reviewing && state.kobo.report && state.kobo.report.removable.length > 0 && <Remove items={state.kobo.report.removable} librarySize={library.books.length}
      close={() => setReviewing(false)} removed={n => {setReviewing(false); setToast({text: `${plural(n, 'livre retiré', 'livres retirés')} de la Kobo`});}}/>}
    {sharing && <Share books={sharing.map(h => library.books.find(b => b.hash === h)).filter((b): b is Book => !!b && !b.problem)} settings={state.settings}
      close={() => {setSharing(null); setSelected(null);}}/>}
    {readingBook && <Suspense fallback={null}>
      <Reader book={readingBook} settings={state.settings} save={s => void save(s).catch(e => setToast({text: e.message}))} close={() => {setReading(null); refresh();}}/>
    </Suspense>}
    {toast && <div className="toast" role="status">{toast.text}
      {toast.undo && <button className="link" onClick={() => {toast.undo?.(); setToast(null);}}>Annuler</button>}</div>}
  </div>;
}

function SelectBar({count, bytes, all, allCount, share}: {count: number; bytes: number; all: () => void; allCount: number; share: () => void}) {
  return <div className="select-bar" role="status">
    <span>{count ? <><b>{plural(count, 'livre', 'livres')}</b> · {size(bytes)}</> : 'Touche les livres à partager'}</span>
    {count < allCount && <button className="link" onClick={all}>Tout sélectionner ({allCount})</button>}
    <button className="primary" disabled={!count} onClick={share}>Partager…</button>
  </div>;
}
