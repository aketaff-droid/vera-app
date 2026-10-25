// The mirror's confirmation (docs/DECISIONS.md, section N): Vera's copies whose book left the folder a day ago or
// more, listed before anything is removed from the Kobo. Nothing goes without this click.
import {useEffect, useState} from 'react';
import {api, type Removable} from '../api';
import {plural, size, when} from '../format';
import {disperse} from '../dust/vera';

export function Remove({items, librarySize, close, removed}: {items: Removable[]; librarySize: number; close: () => void; removed: (n: number) => void}) {
  const [chosen, setChosen] = useState(new Set(items.map(i => i.hash)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A large share of the library leaving at once is more likely a mistake (folder changed, emptied) than a choice.
  const many = items.length > 20 || items.length > 0.2 * (librarySize + items.length);
  const n = chosen.size;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {if (e.key === 'Escape' && !busy) close();};
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, close]);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const n = await api.koboRemove([...chosen]);
      // What left scatters, once the Kobo has really let it go.
      disperse([...document.querySelectorAll<HTMLElement>('.remove [data-row]')].filter(el => chosen.has(el.dataset.row!)).map(el => el.getBoundingClientRect()));
      removed(n);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  const toggle = (hash: string) => {
    const next = new Set(chosen);
    if (next.has(hash)) next.delete(hash); else next.add(hash);
    setChosen(next);
  };

  return <div className="share-layer">
    <button className="share-scrim" aria-label="Fermer" onClick={() => !busy && close()}/>
    <div className="share remove" role="dialog" aria-label="Retirer de la Kobo">
      <div className="share-head">
        <h2>{plural(items.length, 'livre a quitté', 'livres ont quitté')} ton dossier</h2>
        <p>Absents depuis au moins un jour. Pour que ta Kobo reste comme ton dossier, Vera peut les retirer aussi de la liseuse.</p>
      </div>
      <div className="share-body">
        {many && <p className="share-status warn" role="alert">C’est beaucoup d’un coup : as-tu changé de dossier ou l’as-tu vidé par erreur ? Vérifie ton dossier avant de continuer.</p>}
        <div className="share-list">{items.map(item => <label key={item.hash} className="share-row" data-row={item.hash}>
          <input type="checkbox" checked={chosen.has(item.hash)} onChange={() => toggle(item.hash)}/>
          <span className="meta"><b>{item.title}</b><span>{item.authors || 'Auteur inconnu'} · parti {when(item.leftAt)}
            {item.percent ? ` · lu à ${item.percent} % sur la Kobo` : ''}{item.notes ? ` · ${plural(item.notes, 'note gardée', 'notes gardées')} dans Vera` : ''}</span></span>
          <span className="sz">{size(item.size)}</span>
        </label>)}</div>
        <p className="safe">Le retrait est définitif sur la liseuse, avec sa progression. Les surlignages et notes déjà copiés restent dans Vera. Si un livre revient dans ton dossier, Vera le renverra.</p>
        {error && <p className="share-status warn" role="alert">{error}</p>}
      </div>
      <div className="share-foot">
        <span className="sum">{plural(n, 'livre choisi', 'livres choisis')}</span>
        <button className="secondary" disabled={busy} onClick={close}>Plus tard</button>
        <button className="primary danger" disabled={busy || !n} onClick={() => void confirm()}>{busy ? 'Retrait…' : `Retirer ${plural(n, 'livre', 'livres')} de la Kobo`}</button>
      </div>
    </div>
  </div>;
}
