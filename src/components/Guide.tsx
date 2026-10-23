// The guide window (docs/DECISIONS.md, section M): a small panel always on top, beside WhatsApp, Discord or the
// mail application, that walks through the last steps the owner does there. The books are already on the clipboard.
import {useEffect, useState} from 'react';
import {api, coverSrc, type Book} from '../api';
import {applyTheme} from '../theme';
import {plural} from '../format';

type App = 'whatsapp' | 'discord' | 'mail';
const names: Record<App, string> = {whatsapp: 'WhatsApp', discord: 'Discord', mail: 'ta messagerie'};

function stepsFor(app: App, n: number): {title: string; hint: string}[] {
  const books = plural(n, 'livre', 'livres');
  if (app === 'mail') return [
    {title: `Les ${books} sont copiés`, hint: 'Versions préparées par Vera, noms lisibles.'},
    {title: 'Un nouveau message est ouvert', hint: 'Objet et texte sont déjà remplis.'},
    {title: 'Colle avec Ctrl + V', hint: 'Ou glisse les livres depuis l’Explorateur s’ils n’apparaissent pas.'},
    {title: 'Ajoute le destinataire, puis envoie', hint: 'Les grosses pièces jointes peuvent prendre un moment.'},
  ];
  return [
    {title: `Les ${books} sont copiés`, hint: 'Versions préparées par Vera, noms lisibles.'},
    {title: 'Ouvre la conversation', hint: `${names[app]} est ouvert : choisis la personne ou le groupe.`},
    {title: 'Colle avec Ctrl + V', hint: `Les livres apparaissent en pièces jointes dans ${names[app]}.`},
    {title: 'Envoie', hint: `Entrée, ou le bouton d’envoi de ${names[app]}.`},
  ];
}

export function Guide() {
  const params = new URLSearchParams(location.search);
  const app = (['whatsapp', 'discord', 'mail'].includes(params.get('app') ?? '') ? params.get('app') : 'whatsapp') as App;
  const n = Math.max(1, Number(params.get('n')) || 1);
  const hashes = (params.get('h') ?? '').split(',').filter(Boolean);
  const [books, setBooks] = useState<Book[]>([]);
  const [step, setStep] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  const steps = stepsFor(app, n);

  useEffect(() => {
    void api.state().then(s => applyTheme(s.settings.accent, s.settings.appearance)).catch(() => {});
    void api.library().then(l => setBooks(hashes.map(h => l.books.find(b => b.hash === h)).filter((b): b is Book => !!b))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recopy = () => void api.shareGuideRecopy().then(() => {setStep(1); setNote('Livres copiés de nouveau.');}).catch(e => setNote((e as Error).message));
  const finish = () => void api.shareGuideClose();
  return <div className="guide-window">
    <div className="guide-head" data-tauri-drag-region>
      <span className="app-icon" style={{width: 26, height: 26}} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg>
      </span>
      <span data-tauri-drag-region><b>Partager avec {names[app]}</b><small>{plural(n, 'livre', 'livres')} · {params.get('size') ?? ''}</small></span>
      <button className="caption close" aria-label="Fermer le guide" onClick={finish}>✕</button>
    </div>
    <div className="fan" aria-hidden="true">{books.map(b => {
      const src = coverSrc(b.thumb ?? b.cover);
      return src ? <img key={b.hash} src={src} alt=""/> : <span key={b.hash} className="thumb blank"/>;
    })}</div>
    <ol className="guide">{steps.map((s, i) => <li key={i} className={`gstep${i < step ? ' ok' : i === step ? ' now' : ''}`}>
      <span className="gnum">{i < step ? '✓' : i + 1}</span><span className="gt"><b>{s.title}</b><small>{s.hint}</small></span></li>)}</ol>
    {note && <p className="note" role="status">{note}</p>}
    <div className="guide-actions">
      <button className="secondary" onClick={recopy}>Recopier les livres</button>
      {step < steps.length - 1
        ? <button className="primary" onClick={() => setStep(step + 1)}>Étape suivante</button>
        : <button className="primary" onClick={finish}>C’est envoyé</button>}
    </div>
  </div>;
}
