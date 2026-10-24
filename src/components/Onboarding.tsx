import {useEffect, useState} from 'react';
import {api, coverSrc, type AppState, type Library, type Settings, type Suggestion} from '../api';
import {plural} from '../format';
import {Folder, Kobo} from '../icons';
import {Wordmark} from '../logo';

type Step = 'folder' | 'reading' | 'ready';

/** First launch: choose the folder, watch the library fill up, then plug the Kobo. */
export function Onboarding({state, library, save}: {state: AppState; library: Library; save: (s: Settings) => Promise<void>}) {
  const settings = state.settings;
  const [step, setStep] = useState<Step>(settings.watchDir ? 'reading' : 'folder');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {void api.suggestFolder().then(setSuggestion).catch(() => {});}, []);
  // Reading is over when the engine is no longer reading and has looked at the folder at least once.
  useEffect(() => {
    if (step === 'reading' && settings.watchDir && !state.folder.reading && state.folder.last) setStep('ready');
  }, [step, state.folder, settings.watchDir]);

  async function use(path: string) {
    setError(null);
    setStep('reading');
    try {await save({...settings, watchDir: path});} catch (e) {setError((e as Error).message); setStep('folder');}
  }
  async function pick() {
    const path = await api.chooseFolder().catch(() => null);
    if (path) await use(path);
  }

  const [done, total] = state.folder.reading ?? [library.books.length, Math.max(library.books.length, suggestion?.books ?? 0)];
  const covers = library.books.filter(b => b.cover).slice(0, 18);
  const tiles = Array.from({length: 18}, (_, i) => covers[i] ?? null);
  const revealed = total ? Math.round((done / total) * 18) : 0;

  return <div className="center">
    {step === 'folder' && <div className="step">
      <span className="onboarding-mark"><Wordmark height={52}/></span>
      <h1 className="h1">Où sont tes livres ?</h1>
      <p className="lead">Vera les lit dans ce dossier et les envoie sur ta Kobo. Elle n’y modifie et n’y supprime jamais rien.</p>
      {suggestion ? <div className="choice">
        <Folder/>
        <span className="two"><b style={{fontSize: 15}}>{suggestion.path}</b><small>Trouvé sur Google Drive · {plural(suggestion.books, 'EPUB ou PDF', 'EPUB et PDF')}</small></span>
        <button className="primary" onClick={() => void use(suggestion.path)}>Utiliser ce dossier</button>
      </div> : <div className="choice">
        <Folder/>
        <span className="two"><b style={{fontSize: 15}}>Choisis le dossier de tes livres</b><small>Par exemple « Livres » dans ton Google Drive.</small></span>
        <button className="primary" onClick={() => void pick()}>Choisir un dossier…</button>
      </div>}
      {suggestion && <button className="link" style={{alignSelf: 'flex-start'}} onClick={() => void pick()}>Choisir un autre dossier…</button>}
      {error && <p className="note warn" role="alert">{error}</p>}
      <div style={{height: 1, background: 'var(--line)'}}/>
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 14}}>
        <button className="switch" role="switch" aria-checked={settings.autostart} aria-label="Lancer Vera avec Windows" style={{marginTop: 2}}
          onClick={() => void save({...settings, autostart: !settings.autostart})}><span/></button>
        <span style={{display: 'flex', flexDirection: 'column', gap: 3}}>
          <span style={{fontSize: 15}}>Lancer Vera avec Windows</span>
          <span className="note" style={{fontSize: 13}}>Ta Kobo se synchronise dès que tu la branches, même fenêtre fermée.</span>
        </span>
      </div>
    </div>}

    {step === 'reading' && <div className="step wide">
      <h1 className="h1">Lecture de ta bibliothèque</h1>
      <div className="big-count"><b>{done}</b><span>{total ? `livres sur ${total}` : 'livres'}</span></div>
      <span className="bar" style={{maxWidth: 'none'}}><span style={{width: `${total ? (done / total) * 100 : 0}%`}}/></span>
      <span className="note">Vera lit chaque livre une seule fois ; un dossier Google Drive peut prendre quelques minutes.</span>
      <div className="mosaic" aria-hidden="true">
        {tiles.map((book, i) => <span key={i} style={{opacity: i < revealed ? 1 : .25, animationDelay: `${i * 40}ms`}}>
          {book && i < revealed && <img src={coverSrc(book.cover) ?? ''} alt=""/>}
        </span>)}
      </div>
    </div>}

    {step === 'ready' && <div className="step">
      <h1 className="h1">Ta bibliothèque est prête</h1>
      <p className="lead">{plural(library.books.length, 'livre', 'livres')}, {library.collections.length ? `rangés dans ${plural(library.collections.length, 'collection', 'collections')} d’après tes dossiers.` : 'sans sous-dossier pour l’instant.'}</p>
      <div className="choice">
        <Kobo size={28}/>
        <span className="two"><b style={{fontSize: 15}}>Branche ta Kobo</b>
          <small style={{lineHeight: 1.45}}>Vera y enverra {library.books.length > 1 ? `tes ${library.books.length} livres` : 'ton livre'} et rangera tes collections en étagères. Le premier envoi peut prendre quelques minutes.</small></span>
      </div>
      <button className="primary" style={{alignSelf: 'flex-start'}} onClick={() => void save({...settings, onboarded: true})}>Ouvrir la bibliothèque</button>
    </div>}
  </div>;
}
