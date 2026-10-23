import {useEffect, useState} from 'react';
import {api, type Report} from '../api';
import {list, plural, size, when} from '../format';

/** The last synchronisations, newest first: what left, what could not, and the shelves. */
export function Journal() {
  const [entries, setEntries] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  useEffect(() => {void api.journal().then(setEntries).catch(e => setError(e.message));}, []);
  if (error) return <p className="note warn">{error}</p>;
  if (!entries) return null;
  if (!entries.length) return <p className="note" style={{fontSize: 15}}>Aucune synchronisation pour l’instant : branche ta Kobo.</p>;
  return <div className="journal">{entries.map((r, i) => {
    const sent = r.results.filter(x => x.outcome === 'copied' || x.outcome === 'updated');
    const noSpace = r.results.filter(x => x.outcome === 'noSpace');
    const failed = r.results.filter(x => x.outcome === 'failed');
    const trouble = noSpace.length + failed.length > 0 || !!r.shelvesError;
    const summary = sent.length ? plural(sent.length, 'livre envoyé', 'livres envoyés') : 'Rien à envoyer';
    const details = [
      ...sent.map(x => ({text: `${x.title}${x.outcome === 'updated' ? ' (remplacé)' : ''}`, warn: false})),
      ...noSpace.map(x => ({text: `${x.title} : pas assez de place`, warn: true})),
      ...failed.map(x => ({text: `${x.title} : ${x.detail ?? 'échec'}`, warn: true})),
      ...(r.shelvesError ? [{text: `Étagères non rangées : ${r.shelvesError}`, warn: true}] : []),
    ];
    const shelves = r.shelves && (r.shelves.created || r.shelves.added) ? ` · étagères : ${list([
      ...(r.shelves.created ? [plural(r.shelves.created, 'créée', 'créées')] : []),
      ...(r.shelves.added ? [plural(r.shelves.added, 'livre rangé', 'livres rangés')] : []),
    ])}` : '';
    return <div key={`${r.at}-${i}`} className="entry" data-open={open === i}>
      <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} disabled={!details.length}>
        <span className={`state${trouble ? ' warn' : sent.length ? '' : ' quiet'}`} aria-hidden="true"/>
        <span className="what">
          <b>{summary}{noSpace.length ? ` · ${plural(noSpace.length, 'resté', 'restés')} faute de place` : ''}{failed.length ? ` · ${plural(failed.length, 'échec', 'échecs')}` : ''}</b>
          <span>{r.model} · {size(r.freeBytes)} libres ensuite{shelves}</span>
        </span>
        <span className="at">{when(r.at)}</span>
        {details.length > 0 && <span className="chev" aria-hidden="true">›</span>}
      </button>
      {open === i && details.length > 0 && <ul>{details.map((d, n) => <li key={n} className={d.warn ? 'warn' : undefined}>{d.text}</li>)}</ul>}
    </div>;
  })}</div>;
}
