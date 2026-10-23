import {useEffect, useState, type ReactNode} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {inTauri, type AppState, type Collection, type Library} from '../api';
import {size, when} from '../format';
import {AppIcon, Books, Caption, Eject, FolderSmall, Gear, Kobo, Person, Stack} from '../icons';

export type View = {kind: 'all'} | {kind: 'collections'} | {kind: 'collection'; name: string} | {kind: 'authors'} | {kind: 'author'; name: string}
  | {kind: 'settings'} | {kind: 'journal'};
export const sameView = (a: View, b: View) => a.kind === b.kind && (!('name' in a) || ('name' in b && a.name === b.name));

/** Vera draws its own caption buttons; the strip around them drags the window (a double click maximises). The
 *  reader puts its own buttons in it, as Apple Books does in its toolbar. */
export function TitleBar({children}: {children?: ReactNode}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!inTauri) return;
    const window = getCurrentWindow();
    const check = () => void window.isMaximized().then(setMaximized).catch(() => {});
    check();
    const off = window.onResized(check);
    return () => void off.then(f => f());
  }, []);
  const act = (action: 'minimize' | 'toggleMaximize' | 'close') => () => {if (inTauri) void getCurrentWindow()[action]();};
  return <div className={`titlebar${children ? ' tall' : ''}`}>
    {children ?? <div className="titlebar-drag" data-tauri-drag-region/>}
    <button className="caption" aria-label="Réduire la fenêtre" onClick={act('minimize')}><Caption.minimize/></button>
    <button className="caption" aria-label={maximized ? 'Restaurer la fenêtre' : 'Agrandir la fenêtre'} onClick={act('toggleMaximize')}>{maximized ? <Caption.restore/> : <Caption.maximize/>}</button>
    <button className="caption close" aria-label="Fermer la fenêtre — Vera reste active dans la zone de notification" onClick={act('close')}><Caption.close/></button>
  </div>;
}

interface SidebarProps {
  state: AppState;
  library: Library;
  authors: number;
  view: View;
  go: (view: View) => void;
  eject: () => void;
}

export function Sidebar({state, library, authors, view, go, eject}: SidebarProps) {
  const tops = library.collections.filter(c => c.parent === null);
  const children = (parent: string) => library.collections.filter(c => c.parent === parent);
  const row = (target: View, label: string, count: number | null, icon: ReactNode, depth = 0) =>
    <button key={label + depth + ('name' in target ? target.name : target.kind)} className="side-row"
      style={{paddingLeft: 10 + depth * 14}} aria-current={sameView(view, target) ? 'page' : undefined} onClick={() => go(target)}>
      <span className="ico">{icon}</span><span className="label">{label}</span>{count !== null && <span className="count">{count}</span>}
    </button>;
  const tree = (c: Collection, depth: number): ReactNode[] =>
    [row({kind: 'collection', name: c.name}, c.label, c.total, <FolderSmall/>, depth), ...children(c.name).flatMap(child => tree(child, depth + 1))];
  return <nav className="side" aria-label="Bibliothèque">
    <div className="mark"><AppIcon/><span>Vera</span></div>
    <div className="side-group">
      <span className="side-label">Bibliothèque</span>
      {row({kind: 'all'}, 'Tous les livres', library.books.length, <Books/>)}
      {row({kind: 'collections'}, 'Collections', tops.length, <Stack/>)}
      {row({kind: 'authors'}, 'Auteurs', authors, <Person/>)}
    </div>
    {tops.length > 0 && <div className="side-group">
      <span className="side-label">Collections</span>
      {tops.flatMap(c => tree(c, 0))}
    </div>}
    <Device state={state} eject={eject}/>
    <div className="side-foot">
      {state.update && view.kind !== 'settings' && <button className="update-pill" onClick={() => go({kind: 'settings'})}>
        <span className="dot" aria-hidden="true"/>Vera {state.update.version} est disponible</button>}
      <FolderLine state={state} count={library.books.length}/>
      {row({kind: 'settings'}, 'Réglages', null, <Gear/>)}
    </div>
  </nav>;
}

/** Below this the Kobo is said to be nearly full, as in the notification area (src-tauri/src/background.rs). */
const LOW_SPACE = 500 * 1024 * 1024;

function Device({state, eject}: {state: AppState; eject: () => void}) {
  const k = state.kobo;
  const device = k.device;
  const step = k.step;
  const noSpace = k.report?.results.filter(r => r.outcome === 'noSpace').length ?? 0;
  let line: string;
  let warn = false;
  if (!device) {
    line = state.deviceKnown && state.lastSyncAt ? `Synchronisée ${when(state.lastSyncAt)}` : 'Pas encore branchée';
    if (state.lastFree !== null && state.lastFree < LOW_SPACE) {line = `Presque pleine · ${size(state.lastFree)} libres`; warn = true;}
  }
  else if (k.ejected) line = 'Éjectée';
  else if (k.ejecting) line = 'Éjection…';
  else if (step?.stage === 'sending') line = `Envoi ${step.index + 1} sur ${step.total}`;
  else if (k.syncing) line = 'Synchronisation…';
  else if (k.error) {line = 'Synchronisation interrompue'; warn = true;}
  else if (noSpace > 0) {line = `Plus de place · ${noSpace} en attente`; warn = true;}
  else if (k.report) {line = `À jour · ${size(k.report.freeBytes)} libres`; warn = k.report.freeBytes < LOW_SPACE;}
  else line = 'Branchée';
  const progress = step?.stage === 'sending' ? (step.index + (step.size ? step.done / step.size : 0)) / Math.max(step.total, 1) : null;
  const canEject = !!device && !k.syncing && !k.ejecting && !k.ejected;
  return <div className="side-group">
    <span className="side-label">Appareils</span>
    <div className={`device${device && !k.ejected ? ' on' : ''}`}>
      <span className="ico"><Kobo/></span>
      <span style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column'}}>
        <span className="name">{device?.model ?? 'Kobo'}</span>
        <span className={`dline${warn ? ' warn' : ''}`}>{line}</span>
      </span>
      {progress !== null && <Ring value={progress} size={20}/>}
      {canEject && <button className="icon-button" aria-label="Éjecter la Kobo" title="Éjecter la Kobo" onClick={eject}><Eject/></button>}
    </div>
  </div>;
}

export function Ring({value, size: px}: {value: number; size: number}) {
  const r = px / 2 - 2;
  const length = 2 * Math.PI * r;
  return <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} role="img" aria-label={`Envoi en cours, ${Math.round(value * 100)} %`}>
    <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="var(--field)" strokeWidth="2.5"/>
    <circle className="ring" cx={px / 2} cy={px / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"
      strokeDasharray={length} strokeDashoffset={length * (1 - value)} transform={`rotate(-90 ${px / 2} ${px / 2})`}/>
  </svg>;
}

function FolderLine({state, count}: {state: AppState; count: number}) {
  const f = state.folder;
  if (!state.settings.watchDir) return null;
  if (f.error) return <span className="folder-line warn">Dossier introuvable</span>;
  if (f.reading) return <span className="folder-line">Lecture de {f.reading[0]} sur {f.reading[1]}</span>;
  return <span className="folder-line" title={state.settings.watchDir}>{count ? 'Dossier surveillé' : 'Dossier surveillé · vide'}</span>;
}
