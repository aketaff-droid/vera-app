import {useEffect, useRef, useState, type ReactNode} from 'react';
import {coverSrc, type AppState, type Appearance, type Book, type Collection, type Library as Lib, type Report} from '../api';
import {list, plural, size, type Sort} from '../format';
import {Auto, Check, Kobo, Moon, Search, SortIcon, Sun, Warn} from '../icons';
import {tintBackdrop} from '../theme';
import {Ring} from './Shell';

/* ——— Toolbar: title, search, appearance ——— */

export function Toolbar({title, crumb, onCrumb, query, setQuery, appearance, setAppearance, children}: {
  title: string; crumb?: string; onCrumb?: () => void; query?: string; setQuery?: (q: string) => void;
  appearance: Appearance; setAppearance: (a: Appearance) => void; children?: ReactNode;
}) {
  return <div className="toolbar">
    <div className="toolbar-title">
      {crumb && <button className="crumb" onClick={onCrumb}>‹ {crumb}</button>}
      <h1 className="h1">{title}</h1>
    </div>
    <div className="tools">
      {children}
      {setQuery && <label className="search"><Search/>
        <input id="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher" aria-label="Rechercher un livre par titre ou auteur"/>
      </label>}
      <AppearanceMenu value={appearance} onChange={setAppearance}/>
    </div>
  </div>;
}

const modes: [Appearance, string, string][] = [['auto', 'Auto', 'suit Windows'], ['light', 'Clair', ''], ['dark', 'Sombre', '']];

export function AppearanceMenu({value, onChange}: {value: Appearance; onChange: (a: Appearance) => void}) {
  return <ChoiceMenu label="Apparence" value={value} options={modes} onChange={onChange}
    icon={value === 'auto' ? <Auto/> : value === 'light' ? <Sun/> : <Moon/>}/>;
}

const sorts: [Sort, string, string][] = [['recent', 'Ajout récent', ''], ['title', 'Titre', 'A → Z'], ['author', 'Auteur', 'A → Z']];

export function SortMenu({value, onChange}: {value: Sort; onChange: (s: Sort) => void}) {
  return <ChoiceMenu label="Trier par" value={value} options={sorts} onChange={onChange} icon={<SortIcon/>}/>;
}

/** A square button opening a menu of choices, one of them ticked (as macOS's toolbar pop-up menus). */
function ChoiceMenu<T extends string>({label, value, options, onChange, icon}: {label: string; value: T; options: [T, string, string][]; onChange: (v: T) => void; icon: ReactNode}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {if (!box.current?.contains(e.target as Node)) setOpen(false);};
    const key = (e: KeyboardEvent) => {if (e.key === 'Escape') setOpen(false);};
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key);};
  }, [open]);
  const name = options.find(m => m[0] === value)?.[1] ?? '';
  return <div ref={box} style={{position: 'relative'}}>
    <button className="square" aria-haspopup="menu" aria-expanded={open} aria-label={`${label} : ${name}`} title={`${label} : ${name}`} onClick={() => setOpen(!open)}>{icon}</button>
    {open && <div className="menu" role="menu" aria-label={label}>
      <span className="menu-label">{label}</span>
      {options.map(([option, text, hint]) =>
        <button key={option} role="menuitemradio" aria-checked={option === value} onClick={() => {onChange(option); setOpen(false);}}>
          <span className="check">{option === value ? '✓' : ''}</span>{text}<span className="hint">{hint}</span>
        </button>)}
    </div>}
  </div>;
}

/* ——— Kobo: a floating capsule ——— */

const count = (r: Report, outcome: string) => r.results.filter(x => x.outcome === outcome).length;

export function KoboCapsule({state, library, glow, eject, retry, review}: {state: AppState; library: Lib; glow: boolean; eject: () => void; retry: () => void; review: () => void}) {
  const k = state.kobo;
  if (!k.device) return null;
  const model = k.device.model;
  let title = `${model} branchée`, sub = 'Lecture du contenu de la liseuse…', warn = false, wide = false;
  let progress: number | null = null;
  let action: ReactNode = null;
  let extra: ReactNode = null;
  if (k.ejected) {title = 'Tu peux débrancher la Kobo'; sub = 'Elle intègre les nouveaux livres à la déconnexion.';}
  else if (k.ejecting) {title = 'Éjection…'; sub = 'Windows termine les écritures sur la liseuse.';}
  else if (k.step?.stage === 'sending') {
    const s = k.step;
    title = s.title;
    sub = `Envoi ${s.index + 1} sur ${s.total} · ${size(s.done)} sur ${size(s.size)}`;
    progress = (s.index + (s.size ? s.done / s.size : 0)) / Math.max(s.total, 1);
  } else if (k.step?.stage === 'shelves') {title = 'Rangement des étagères'; sub = 'D’après les dossiers de ta bibliothèque.';}
  else if (k.syncing) {/* reading: defaults */}
  else if (k.error) {
    title = 'Synchronisation interrompue'; sub = k.error; warn = true;
    action = <button className="primary" onClick={retry}>Réessayer</button>;
  } else if (k.report) {
    const r = k.report;
    const sent = count(r, 'copied') + count(r, 'updated');
    const noSpace = r.results.filter(x => x.outcome === 'noSpace');
    const failed = r.results.filter(x => x.outcome === 'failed');
    if (noSpace.length) {
      title = `Kobo synchronisée, sauf ${plural(noSpace.length, 'livre', 'livres')}`; warn = true; wide = true;
      sub = `Il manque ${size(r.missingBytes)} : libère de la place sur la Kobo, puis rebranche-la.`;
      const byHash = new Map(library.books.map(b => [b.hash, b]));
      extra = <div className="left-behind">{noSpace.map(x => {
        const book = byHash.get(x.hash);
        const src = coverSrc(book?.thumb ?? book?.cover ?? null);
        return <span key={x.hash}>{src && <img src={src} alt=""/>}
          <span style={{display: 'flex', flexDirection: 'column'}}><b style={{fontWeight: 600}}>{x.title}</b>{book && <span className="note">{size(book.size)} · en attente</span>}</span></span>;
      })}</div>;
    } else if (sent) {
      title = `À jour · ${plural(sent, 'livre ajouté', 'livres ajoutés')}`;
      sub = r.shelves && r.shelves.waiting > 0 ? 'Ils rejoindront leurs étagères au prochain branchement.' : 'Leurs étagères sont prêtes.';
    } else {title = 'Kobo à jour'; sub = 'La liseuse a déjà tous tes livres.';}
    if (failed.length) sub += ` ${plural(failed.length, 'livre n’a', 'livres n’ont')} pas pu partir : ${list(failed.map(f => f.title))}.`;
    if (r.shelvesError) sub += ` Étagères non rangées cette fois : ${r.shelvesError}`;
    action = <button className="primary" onClick={eject}>Éjecter</button>;
    // The mirror: copies whose book left the folder wait for the owner's word.
    if (r.removable.length) {
      wide = true;
      extra = <>{extra}<div className="leaving">
        <span>{plural(r.removable.length, 'livre a quitté', 'livres ont quitté')} ton dossier : {list(r.removable.map(x => x.title))}.</span>
        <button className="secondary" onClick={review}>Retirer de la Kobo…</button>
      </div></>;
    }
  } else {
    sub = 'La synchronisation automatique est coupée (Réglages).';
    action = <button className="primary" onClick={retry}>Synchroniser</button>;
  }
  return <div className={`capsule${glow ? ' glow' : ''}${warn ? ' warn' : ''}${wide ? ' wide' : ''}`} role="status" aria-live="polite">
    <span className="kobo-ico">{progress !== null && <span style={{position: 'absolute', inset: 0}}><Ring value={progress} size={44}/></span>}<Kobo size={15}/></span>
    <span className="text"><span className="title">{title}</span><span className="sub">{sub}</span></span>
    {action}
    {extra}
  </div>;
}

/* ——— Covers ——— */

export function Cover({book, big = false}: {book: Book; big?: boolean}) {
  const src = coverSrc(big ? book.cover ?? book.thumb : book.thumb ?? book.cover);
  if (!src) return <div className={`cover plain${book.problem ? ' broken' : ''}`}>
    <span className="t">{book.title}</span><span className="a">{book.authors}</span>
  </div>;
  return <div className={`cover${book.problem ? ' broken' : ''}`}><img src={src} alt="" loading="lazy" decoding="async"/></div>;
}

export function BookTile({book, waiting, sent, open, selected}: {book: Book; waiting: boolean; sent: boolean; open: () => void; selected?: boolean}) {
  const label = `${book.title}${book.authors ? `, ${book.authors}` : ''}${book.problem ? ', fichier illisible' : waiting ? ', partira au prochain branchement' : ''}`;
  const picking = selected !== undefined;
  return <button className={`cv${picking ? ' picking' : ''}${selected ? ' picked' : ''}`} onClick={open} aria-label={label} aria-pressed={picking ? selected : undefined} data-book={book.hash}>
    <div style={{position: 'relative'}}>
      <Cover book={book}/>
      {picking && <span className="pick" aria-hidden="true">{selected && <Check/>}</span>}
      {book.problem && <span className="badge bad" title="Fichier illisible">!</span>}
      {sent && !book.problem && <span className="badge sent" title="Arrivé sur la Kobo"><Check/></span>}
    </div>
    <span className="meta"><span className="title">{book.title}</span>{waiting && !book.problem && <span className="dot" title="Partira au prochain branchement"/>}</span>
    <span className={`author${book.problem ? ' warn' : ''}`}>{book.problem ? 'Fichier illisible' : book.authors}
      {!book.problem && <Progress book={book}/>}</span>
  </button>;
}

/** What the tiles show: waiting for the Kobo, just sent, and the selection when books are being chosen to share. */
/** How far a book is read: on the Kobo when it has started it there, else in Vera's reader. */
function Progress({book}: {book: Book}) {
  if (book.kobo && book.kobo.status === 2) return <span className="read-pc"> · Lu</span>;
  const fraction = book.kobo && book.kobo.status === 1 ? book.kobo.percent / 100 : book.read;
  if (!fraction) return null;
  return <span className="read-pc">{fraction >= 0.995 ? ' · Lu' : ` · ${Math.round(fraction * 100)} %`}</span>;
}

export interface Marks {waiting: Set<string>; sent: Set<string>; selected?: Set<string>}

export function Group({name, books, marks, open}: {name: string; books: Book[]; marks: Marks; open: (hash: string) => void}) {
  return <section className="group">
    <h2 className="sec">{name}<span className="n">{books.length}</span></h2>
    <div className="grid">{books.map(b => <BookTile key={b.hash} book={b} waiting={marks.waiting.has(b.hash)} sent={marks.sent.has(b.hash)} open={() => open(b.hash)}
      selected={marks.selected ? marks.selected.has(b.hash) : undefined}/>)}</div>
  </section>;
}

/* ——— Featured: what waits for the Kobo, in the colours of its first book ——— */

export function Hero({state, books, marks, open}: {state: AppState; books: Book[]; marks: Marks; open: (hash: string) => void}) {
  const waiting = books.filter(b => marks.waiting.has(b.hash) && !b.problem);
  const justSent = books.filter(b => marks.sent.has(b.hash));
  const recent = [...books].filter(b => !b.problem).sort((a, b) => b.addedAt - a.addedAt);
  const they = (n: number) => n > 1 ? 'Ils partiront' : 'Il partira';
  let shown: Book[], kicker: string, line: string, sub: string;
  if (state.kobo.syncing && waiting.length) {shown = waiting.slice(0, 3); kicker = 'Envoi en cours'; line = 'En route vers ta Kobo'; sub = 'Garde-la branchée jusqu’à la fin de l’envoi.';}
  else if (!state.deviceKnown) {shown = recent.slice(0, 3); kicker = 'Ta bibliothèque'; line = 'Tes derniers livres'; sub = 'Branche ta Kobo : Vera y enverra toute ta bibliothèque.';}
  else if (waiting.length) {
    shown = waiting.slice(0, 3); kicker = 'Nouveaux dans ton dossier';
    line = `${plural(waiting.length, 'livre attend', 'livres attendent')} ta Kobo`;
    const full = state.kobo.device && state.kobo.report?.results.some(r => r.outcome === 'noSpace');
    const short = shortfall(state, waiting);
    sub = full ? `${they(waiting.length)} quand la Kobo aura de la place.`
      : short ? `Il manquera environ ${size(short)} sur la Kobo : libère de la place avant de la brancher.`
      : `${they(waiting.length)} dès que tu la brancheras.`;
  }
  else if (justSent.length) {shown = justSent.slice(0, 3); kicker = 'Synchronisée'; line = 'Tout est sur ta Kobo'; sub = `${plural(justSent.length, 'livre vient', 'livres viennent')} d’y arriver.`;}
  else {shown = recent.slice(0, 3); kicker = 'Synchronisée'; line = 'Tout est sur ta Kobo'; sub = 'Les nouveaux livres de ton dossier partiront au prochain branchement.';}
  if (!shown.length) return null;
  const lead = shown[1] ?? shown[0];
  return <section className="hero" aria-label={line}>
    <div className="hero-bg" style={{background: tintBackdrop(lead?.tint ?? [])}}/>
    <div className="hero-body">
      <div className="hero-text">
        <span className="kicker">{kicker}</span>
        <p className="hero-line">{line}</p>
        <p className="hero-sub">{sub}</p>
      </div>
      <div className="hero-books">{shown.map(b => <BookTile key={b.hash} book={b} waiting={false} sent={marks.sent.has(b.hash)} open={() => open(b.hash)}/>)}</div>
    </div>
  </section>;
}

/** What the waiting books lack on the Kobo, from its free space at the last synchronisation (0 when they fit).
 *  A KEPUB weighs about what its EPUB weighs; 16 Mo stay free, as vera-core keeps them. */
export function shortfall(state: AppState, waiting: Book[]): number {
  if (state.lastFree === null) return 0;
  const need = waiting.reduce((sum, b) => sum + b.size, 0) + 16 * 1024 * 1024;
  return Math.max(0, need - state.lastFree);
}

/* ——— Collections as piles ——— */

export function CollectionCards({collections, books, go}: {collections: Collection[]; books: Book[]; go: (name: string) => void}) {
  if (!collections.length) return null;
  return <div className="cards">{collections.map(c => {
    const inside = books.filter(b => b.collection === c.name || b.collection?.startsWith(`${c.name} › `));
    // Only real covers: one sits in the middle, two fan out, three make the full pile.
    const covers = inside.filter(b => b.thumb ?? b.cover).slice(0, 3).map(b => coverSrc(b.thumb ?? b.cover) ?? '');
    const places = covers.length === 1 ? ['c2'] : covers.length === 2 ? ['c0', 'c1'] : ['c0', 'c1', 'c2'];
    const subNames = [...new Set(inside.map(b => b.collection).filter((n): n is string => !!n && n !== c.name).map(n => n.slice(c.name.length + 3).split(' › ')[0]))];
    return <button key={c.name} className="coll" onClick={() => go(c.name)} aria-label={`Collection ${c.name}, ${plural(c.total, 'livre', 'livres')}`}>
      <span className="fan" aria-hidden="true">{covers.map((src, n) => <span key={n} className={`c ${places[n]}`}><img src={src} alt=""/></span>)}</span>
      <span style={{display: 'flex', flexDirection: 'column', gap: 2}}>
        <span className="name">{c.label}</span>
        <span className="meta">{plural(c.total, 'livre', 'livres')}{subNames.length ? ` · ${subNames.join(', ')}` : ''}</span>
      </span>
    </button>;
  })}</div>;
}

/* ——— When something is wrong ——— */

export function FolderAlert({dir, retry, change}: {dir: string; retry: () => void; change: () => void}) {
  return <div className="alert" role="alert">
    <span style={{color: 'var(--warn)', marginTop: 1}}><Warn/></span>
    <span className="text">
      <span className="title">Je ne vois pas ton dossier de livres</span>
      <span className="sub">{dir} est introuvable. Google Drive est-il lancé ? En attendant, rien ne bouge : ta bibliothèque reste telle quelle et rien n’est supprimé.</span>
    </span>
    <span className="actions">
      <button className="primary" onClick={retry}>Réessayer</button>
      <button className="secondary" onClick={change}>Changer de dossier</button>
    </span>
  </div>;
}

export function Empty({dir, open}: {dir: string; open: () => void}) {
  return <div className="empty">
    <span style={{color: 'var(--faint)'}}><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg></span>
    <h1 className="h1" style={{fontSize: 28}}>Ton dossier est vide</h1>
    <p>Dépose des EPUB ou des PDF dans {dir} : ils apparaîtront ici, puis sur ta Kobo au prochain branchement.</p>
    <button className="primary" style={{marginTop: 6}} onClick={open}>Ouvrir le dossier</button>
  </div>;
}
