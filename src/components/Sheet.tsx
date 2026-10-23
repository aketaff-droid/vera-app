import {useEffect, useState} from 'react';
import {api, type Annotation, type Detail, type Found, type Metadata} from '../api';
import {tintBackdrop} from '../theme';
import {Close} from '../icons';
import {Cover} from './Library';

type Editable = 'title' | 'authors' | 'isbn' | 'publisher' | 'published';
const fields: [Editable, string][] = [['title', 'Titre'], ['authors', 'Auteur'], ['isbn', 'ISBN'], ['publisher', 'Éditeur'], ['published', 'Parution']];
const value = (m: Metadata, key: Editable) => (key === 'isbn' ? m.isbn ?? '' : m[key]);
const set = (m: Metadata, key: Editable, text: string): Metadata => key === 'isbn' ? {...m, isbn: text.trim() || null} : {...m, [key]: text};

interface Props {
  hash: string;
  onKobo: boolean;
  replaceEdited: boolean;
  close: () => void;
  saved: (undo: () => void) => void;
  read: () => void;
  share: () => void;
}

/** A book's card: corrections are saved as soon as a field is left, with an « Annuler » offered for a moment. */
export function Sheet({hash, onKobo, replaceEdited, close, saved, read, share}: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Metadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [looking, setLooking] = useState(false);

  const load = () => api.detail(hash).then(d => {setDetail(d); setDraft(d.metadata); setError(null);}).catch(e => setError(e.message));
  useEffect(() => {setFound(null); void load();}, [hash]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) close();};
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [close]);

  async function save(next: Metadata) {
    if (!detail || JSON.stringify(next) === JSON.stringify(detail.metadata)) return;
    const before = detail.metadata;
    try {
      const revision = await api.saveCard(hash, next, detail.revision);
      setDetail({...detail, metadata: next, revision});
      setError(null);
      saved(() => void api.saveCard(hash, before, revision).then(() => load()));
    } catch (e) {
      setError((e as Error).message);
      setDraft(detail.metadata);
    }
  }

  async function lookup() {
    if (!draft?.isbn) {setError('Ajoute l’ISBN du livre (souvent au dos ou dans les premières pages) pour le chercher.'); return;}
    setLooking(true); setError(null); setFound(null);
    try {
      const result = await api.lookup(draft.isbn);
      setFound(result);
      // What is missing is proposed ticked; what would replace your own text is offered unticked.
      setPicked(new Set(offers(result, draft).filter(o => !o.current).map(o => o.key)));
    } catch (e) {setError((e as Error).message);} finally {setLooking(false);}
  }

  function accept() {
    if (!found || !draft) return;
    let next = draft;
    for (const o of offers(found, draft)) if (picked.has(o.key)) next = o.apply(next);
    setDraft(next); setFound(null); void save(next);
  }

  if (!detail || !draft) return <aside className="sheet" aria-label="Fiche du livre"><div className="sheet-bg" style={{background: tintBackdrop([])}}/><div className="sheet-body">
    <button className="sheet-close" onClick={close} aria-label="Fermer la fiche"><Close/></button>{error && <p className="note warn">{error}</p>}
  </div></aside>;
  const book = detail.book;
  const kobo = book.kobo;
  const status = book.problem ? 'Fichier illisible, jamais envoyé' : !onKobo ? 'Partira au prochain branchement'
    : kobo?.status === 2 ? 'Sur la liseuse · lu' : kobo?.status === 1 ? `Sur la liseuse · lu à ${kobo.percent} %` : 'Sur la liseuse';
  return <aside className="sheet" aria-label={`Fiche de ${book.title}`}>
    <div className="sheet-bg" style={{background: tintBackdrop(book.tint)}}/>
    <div className="sheet-body">
      <button className="sheet-close" onClick={close} aria-label="Fermer la fiche"><Close/></button>
      <Cover book={book} big/>
      <div className="sheet-title"><div className="t">{draft.title}</div><div className="a">{draft.authors}</div></div>
      {book.problem ? <>
        <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
          <span className="problem" style={{fontSize: 15, fontWeight: 600}}>Ce fichier ne peut pas être lu</span>
          <span className="note" style={{fontSize: 14, lineHeight: 1.45}}>{book.problem} Il reste dans ton dossier, et Vera ne l’enverra pas sur la Kobo tant qu’il n’est pas remplacé.</span>
        </div>
        <button className="secondary" onClick={() => void api.reveal(hash)}>Afficher dans l’Explorateur</button>
      </> : <>
        <button className="primary read" onClick={read}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg>
          {book.read ? `Reprendre · ${Math.round(book.read * 100)} %` : 'Lire'}</button>
        <button className="secondary share-one" onClick={share}>Partager…</button>
        <div className="fields">
          {fields.map(([key, label]) => <label className="field" key={key}><span>{label}</span>
            <input value={value(draft, key)} placeholder="Ajouter" onChange={e => setDraft(set(draft, key, e.target.value))}
              onBlur={() => void save(draft)} onKeyDown={e => {if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') {setDraft(detail.metadata); (e.target as HTMLInputElement).blur();}}}/>
          </label>)}
          <div className="field"><span>Collection</span><span className="value">{book.collection ?? 'Hors collection'}</span></div>
          <div className="field"><span>Kobo</span><span className="value">{status}</span></div>
        </div>
        {book.notes > 0 && <Notes hash={hash} title={book.title} authors={book.authors} count={book.notes}/>}
        {book.twin && <p className="note">Un autre fichier porte le même titre et le même auteur : voir « Doublons probables » dans la Bibliothèque.</p>}
        {book.madeCover && <p className="note">{book.format === 'pdf' ? 'Couverture tirée de la première page.' : 'Couverture créée par Vera, ajoutée à la copie envoyée sur la Kobo.'}</p>}
        {book.edited && onKobo && !replaceEdited && <p className="note">Déjà sur la Kobo : la correction s’y verra une fois le remplacement des livres corrigés activé dans les réglages.</p>}
        {found ? <div className="fields found">
          <span className="note">Trouvé sur Open Library · coche ce que tu veux garder</span>
          {offers(found, draft).map(o => <label key={o.key} className="row">
            <span>{o.label}</span>
            <span style={{display: 'flex', gap: 8, alignItems: 'baseline', textAlign: 'right'}}>
              <span>{o.text}{o.current && <span className="note"> (remplace « {o.current} »)</span>}</span>
              <input type="checkbox" checked={picked.has(o.key)} onChange={e => {const next = new Set(picked); if (e.target.checked) next.add(o.key); else next.delete(o.key); setPicked(next);}}/>
            </span>
          </label>)}
          {offers(found, draft).length === 0 && <span>Rien de nouveau : ta fiche contient déjà ces informations.</span>}
          {found.warnings.map(w => <span key={w} className="note">{w}</span>)}
          <span style={{display: 'flex', gap: 8, marginTop: 6}}>
            <button className="primary" style={{flex: 1}} disabled={!picked.size} onClick={accept}>Ajouter</button>
            <button className="secondary" style={{flex: 1}} onClick={() => setFound(null)}>Ignorer</button>
          </span>
        </div> : <button className="secondary" style={{alignSelf: 'center'}} disabled={looking} onClick={() => void lookup()}>{looking ? 'Recherche…' : 'Compléter la fiche'}</button>}
        {detail.book.edited && <button className="link" style={{alignSelf: 'center', fontSize: 12}} onClick={() => {setDraft(detail.original); void save(detail.original);}}>Revenir aux informations du fichier</button>}
      </>}
      {error && <p className="note warn" role="alert">{error}</p>}
    </div>
  </aside>;
}

interface Offer {key: string; label: string; text: string; current: string; apply: (m: Metadata) => Metadata}

function offers(found: Found, m: Metadata): Offer[] {
  const out: Offer[] = [];
  const add = (key: Editable | 'description', label: string, text: string | null) => {
    if (!text) return;
    const current = key === 'description' ? m.description : value(m, key);
    if (current.trim() === text.trim()) return;
    out.push({key, label, text: text.length > 90 ? `${text.slice(0, 90)}…` : text, current: current.length > 40 ? `${current.slice(0, 40)}…` : current,
      apply: x => key === 'description' ? {...x, description: text} : set(x, key, text)});
  };
  add('title', 'Titre', found.title);
  add('authors', 'Auteur', found.authors);
  add('publisher', 'Éditeur', found.publisher);
  add('published', 'Parution', found.published);
  add('description', 'Résumé', found.description);
  return out;
}

/** The highlights and notes made on the Kobo, copied by Vera at each plug; they stay even after the book leaves it. */
function Notes({hash, title, authors, count}: {hash: string; title: string; authors: string; count: number}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Annotation[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {if (open && !notes) void api.annotations(hash).then(setNotes).catch(() => setNotes([]));}, [open, notes, hash]);
  const save = () => void api.exportAnnotations(hash, title, authors).then(path => path && setSaved(`Enregistré : ${path}`)).catch(e => setSaved((e as Error).message));
  return <div className="notes">
    <div className="notes-head">
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {count > 1 ? `${count} notes` : '1 note'} de la Kobo</button>
      <button className="secondary small" onClick={save}>Exporter…</button>
    </div>
    {open && notes && <ol className="notes-list">{notes.map((n, i) => <li key={i}>
      {n.text && <blockquote>{n.text}</blockquote>}
      {n.note && <p className="mine">{n.note}</p>}
      <span className="where">{Math.round(n.progress * 100)} %</span>
    </li>)}</ol>}
    {saved && <p className="note" role="status">{saved}</p>}
  </div>;
}
