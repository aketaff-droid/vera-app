import {useState} from 'react';
import {api, coverSrc, type Book} from '../api';
import {plural, size} from '../format';

/** Probable duplicates: the same title and author in two files. Vera only tells; the owner decides, in the folder. */
export function Twins({groups, books, open, dismissed}: {groups: string[][]; books: Book[]; open: (hash: string) => void; dismissed: () => void}) {
  const [shown, setShown] = useState(false);
  const byHash = new Map(books.map(b => [b.hash, b]));
  const sets = groups.map(g => g.map(h => byHash.get(h)).filter((b): b is Book => !!b)).filter(g => g.length > 1);
  if (!sets.length) return null;
  return <section className="twins" aria-label="Doublons probables">
    <div className="twins-head">
      <span className="text">
        <span className="title">{plural(sets.length, 'doublon probable', 'doublons probables')}</span>
        <span className="sub">Même titre et même auteur dans plusieurs fichiers. Vera les enverra tous les deux ; garde celui que tu préfères dans ton dossier : Vera n’y touche jamais, et proposera ensuite de retirer l’autre de la Kobo.</span>
      </span>
      <button className="secondary" aria-expanded={shown} onClick={() => setShown(!shown)}>{shown ? 'Masquer' : 'Voir'}</button>
    </div>
    {shown && sets.map(set => <div key={set[0]!.hash} className="twin-group">
      {set.map(b => {
        const src = coverSrc(b.thumb ?? b.cover);
        return <div key={b.hash} className="twin-file">
          {src ? <img src={src} alt=""/> : <span className="blank"/>}
          <span className="text">
            <button className="link" style={{alignSelf: 'flex-start', padding: 0, fontWeight: 600, color: 'var(--ink)'}} onClick={() => open(b.hash)}>{b.title}</button>
            <span className="path" title={b.path}>&lrm;{b.path}</span>
            <span className="note">{b.format.toUpperCase()} · {size(b.size)}{b.collection ? ` · ${b.collection}` : ''}</span>
          </span>
          <button className="secondary" onClick={() => void api.reveal(b.hash)} title="Afficher dans l’Explorateur">Montrer le fichier</button>
        </div>;
      })}
      <span className="twin-actions"><button className="link" onClick={() => void api.dismissTwins(set.map(b => b.hash)).then(dismissed)}>Ce ne sont pas des doublons</button></span>
    </div>)}
  </section>;
}
