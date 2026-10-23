import {useEffect, useState} from 'react';
import {getVersion} from '@tauri-apps/api/app';
import {api, inTauri, listen, type AppState, type Appearance, type Library, type Settings as S, type UpdateInfo} from '../api';
import {plural, when} from '../format';
import {accentName, accentOrder, effective, themeOrder, themes, tone} from '../theme';

const Switch = ({on, label, toggle}: {on: boolean; label: string; toggle: () => void}) =>
  <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={toggle}><span/></button>;

function Segmented<T extends string>({label, value, options, onChange}: {label: string; value: T; options: [T, string][]; onChange: (v: T) => void}) {
  return <span className="seg" role="radiogroup" aria-label={label}>
    {options.map(([v, text]) => <button key={v} role="radio" aria-checked={v === value} onClick={() => onChange(v)}>{text}</button>)}
  </span>;
}

export function Settings({state, library, save, changeFolder, journal, tour}: {state: AppState; library: Library; save: (s: S) => Promise<void>; changeFolder: () => void; journal: () => void; tour: () => void}) {
  const s = state.settings;
  const [version, setVersion] = useState('2.6.0');
  useEffect(() => {if (inTauri) void getVersion().then(setVersion);}, []);
  const folderState = state.folder.error ? 'Introuvable : Google Drive est-il lancé ?'
    : `Surveillé · ${plural(library.books.length, 'livre', 'livres')} · ${plural(library.collections.filter(c => !c.parent).length, 'collection', 'collections')}`;
  const last = state.kobo.report?.at ?? state.lastSyncAt;
  const lastText = last ? when(last) : 'jamais';
  return <div className="settings">
    <section>
      <h2 className="gh">Bibliothèque</h2>
      <div className="grp">
        <div className="line"><span className="two"><span>Dossier surveillé</span><small>{s.watchDir ?? 'Aucun'}</small></span>
          <button className="secondary" onClick={changeFolder}>Changer…</button></div>
        <div className="line"><span>État</span><span className="value" style={state.folder.error ? {color: 'var(--warn)'} : undefined}>{folderState}</span></div>
      </div>
      <p className="footnote">Seuls les EPUB et les PDF sont pris en compte. Vera ne modifie ni ne supprime jamais rien dans ce dossier.</p>
    </section>

    <section>
      <h2 className="gh">Kobo</h2>
      <div className="grp">
        <div className="line"><span className="two"><span>Synchroniser à chaque branchement</span><small>Envoie les nouveaux livres et range les étagères.</small></span>
          <Switch on={s.koboSync} label="Synchroniser à chaque branchement" toggle={() => void save({...s, koboSync: !s.koboSync})}/></div>
        <div className="line"><span>Dernière synchronisation</span><span className="value">{lastText}</span></div>
        <button className="line" onClick={journal}>Journal des synchronisations<span className="value">›</span></button>
        <div className="line"><span>Étagères</span><span className="value">Une par dossier · les tiennes ne sont jamais touchées</span></div>
        <div className="line"><span className="two"><span>Miroir de ton dossier</span>
          <small>Un livre retiré de ton dossier depuis un jour est proposé au retrait de la Kobo, avec ta confirmation. Un livre supprimé sur la Kobo mais toujours dans ton dossier y est renvoyé. Les livres mis sur la Kobo autrement ne sont jamais touchés.</small></span></div>
        <div className="line"><span className="two"><span>Remplacer sur la Kobo les livres corrigés</span>
          <small>Une fiche corrigée après l’envoi remplace la copie de Vera sur la liseuse. À n’activer qu’après avoir vérifié sur ta Kobo qu’un livre remplacé garde ta page de lecture.</small></span>
          <Switch on={s.replaceEdited} label="Remplacer sur la Kobo les livres corrigés" toggle={() => void save({...s, replaceEdited: !s.replaceEdited})}/></div>
      </div>
    </section>

    <section>
      <h2 className="gh">Démarrage</h2>
      <div className="grp">
        <div className="line"><span className="two"><span>Lancer Vera avec Windows</span><small>Nécessaire pour synchroniser la Kobo fenêtre fermée.</small></span>
          <Switch on={s.autostart} label="Lancer Vera avec Windows" toggle={() => void save({...s, autostart: !s.autostart})}/></div>
      </div>
    </section>

    <section>
      <h2 className="gh">Apparence</h2>
      <div className="grp">
        <div className="line themes-line"><span className="two"><span>Thème</span><small>{themes[s.theme]?.note}. La lecture garde ses propres fonds.</small></span></div>
        <div className="theme-cards" role="radiogroup" aria-label="Thème">
          {themeOrder.map(id => {
            const t = themes[id], mode = effective(s.appearance), p = t.surfaces[mode];
            return <button key={id} className="theme-card" role="radio" aria-checked={id === s.theme} onClick={() => void save({...s, theme: id, accent: 'maison'})}>
              <span className={`theme-preview tp-${id}`} style={{background: p.bg, color: p.ink, borderColor: p.line}} aria-hidden="true">
                <span className="tp-side" style={{background: p.card}}/>
                <span className="tp-title" style={{fontFamily: t.display}}>Aa</span>
                <span className="tp-lines"><i style={{background: p.ink}}/><i style={{background: p.muted}}/></span>
                <span className="tp-dot" style={{background: t.accent[mode].fill}}/>
              </span>
              <span className="theme-name">{t.name}</span>
            </button>;
          })}
        </div>
        <div className="line"><span className="two"><span>Couleur d’accent</span><small>{accentName(s.accent, s.theme)}</small></span>
          <span className="swatches" role="radiogroup" aria-label="Couleur d’accent">
            {accentOrder.map(a => {
              const fill = tone(s.theme, a, effective(s.appearance)).fill;
              return <button key={a} className={`swatch${a === 'maison' ? ' maison' : ''}`} role="radio" aria-checked={a === s.accent} aria-label={accentName(a, s.theme)} title={accentName(a, s.theme)}
                style={{background: fill, ['--swatch' as string]: fill}} onClick={() => void save({...s, accent: a})}/>;
            })}
          </span></div>
        <div className="line"><span className="two"><span>Apparence</span>
          <small>{s.appearance === 'auto' ? `Suit Windows : actuellement ${effective('auto') === 'dark' ? 'sombre' : 'clair'}` : 'Ne suit plus Windows'}</small></span>
          <Segmented<Appearance> label="Apparence" value={s.appearance} options={[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']]} onChange={appearance => void save({...s, appearance})}/></div>
      </div>
    </section>

    <section>
      <h2 className="gh">À propos</h2>
      <div className="grp">
        <div className="line"><span>Version</span><span className="value">Vera {version}</span></div>
        <Update available={state.update}/>
        <button className="line" onClick={tour}>Revoir la visite guidée<span className="value">›</span></button>
        <button className="line" onClick={() => void api.openData()}>Ouvrir le dossier des données de Vera<span className="value">›</span></button>
      </div>
      <p className="footnote">Notices et licences : dossier « notices » de l’installation. Sauvegardes du catalogue de la Kobo : dossier « backups » des données.</p>
    </section>
  </div>;
}

/** Updates from Vera (docs/DECISIONS.md, section O): look for a new version, then install it on a click; Vera restarts
 *  by itself and keeps its settings and library. */
function Update({available}: {available: UpdateInfo | null}) {
  const [found, setFound] = useState<UpdateInfo | null>(available);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => setFound(available), [available]);
  useEffect(() => listen<[number, number | null]>('update-progress', ([done, total]) => setProgress(total ? done / total : null)), []);
  async function check() {
    setBusy(true); setNote(null);
    try {const u = await api.updateCheck(); setFound(u); if (!u) setNote('Vera est à jour.');} catch (e) {setNote((e as Error).message);} finally {setBusy(false);}
  }
  async function install() {
    setBusy(true); setNote(null); setProgress(0);
    try {await api.updateInstall();} catch (e) {setNote((e as Error).message); setProgress(null); setBusy(false);}
  }
  if (!found) return <div className="line"><span className="two"><span>Mises à jour</span><small>{note ?? 'Vera vérifie toute seule, au démarrage puis toutes les 6 heures.'}</small></span>
    <button className="secondary" disabled={busy} onClick={() => void check()}>{busy ? 'Recherche…' : 'Rechercher'}</button></div>;
  return <div className="line update-line"><span className="two"><span><b>Vera {found.version} est disponible</b></span>
    {found.notes && <small className="update-notes">{found.notes}</small>}
    {progress !== null ? <span className="update-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{width: `${Math.round(progress * 100)}%`}}/></span>
      : <small>Téléchargement, vérification de la signature, puis installation : Vera redémarre seule. Tes réglages et ta bibliothèque sont gardés.</small>}
    {note && <small className="warn">{note}</small>}</span>
    <button className="primary" disabled={busy} onClick={() => void install()}>{progress !== null ? 'Installation…' : 'Installer et redémarrer'}</button></div>;
}
