// The guided start (docs/DECISIONS.md, section P): a few bubbles over the real window, each lighting one place of
// Vera, shown once after the first start and on demand from the settings. Nothing is done for the user: it only shows.
import {useCallback, useEffect, useLayoutEffect, useState} from 'react';
import {AppIcon} from '../icons';

interface Step {target?: string; title: string; text: string}

const STEPS: Step[] = [
  {title: 'Bienvenue dans Vera', text: 'Vera tient ta Kobo à l’image de ton dossier de livres. Voici l’essentiel en quelques étapes ; tu peux passer à tout moment.'},
  {target: '[data-tour="library"]', title: 'Ta bibliothèque', text: 'Tous les livres de ton dossier, EPUB et PDF. Vera les lit sans jamais rien modifier ni supprimer dans le dossier.'},
  {target: '[data-tour="collections"]', title: 'Tes collections', text: 'Chaque sous-dossier devient une collection ici et une étagère sur la Kobo. La flèche replie ou déplie une collection.'},
  {target: '.grid .cv', title: 'Un livre', text: 'Clique sur une couverture pour sa fiche : la lire dans Vera, corriger son titre ou son auteur, voir où tu en es sur la Kobo et tes notes.'},
  {target: '[data-tour="select"]', title: 'Partager', text: 'Sélectionne un ou plusieurs livres, puis « Partager » : par e-mail, sur Discord, WhatsApp ou une clé USB, Vera t’accompagne.'},
  {target: '[data-tour="kobo"]', title: 'Ta Kobo', text: 'Branche-la : Vera envoie les nouveaux livres et range les étagères, même fenêtre fermée. Attends la fin de l’envoi, puis éjecte-la ici.'},
  {target: '[data-tour="settings"]', title: 'À ton goût', text: 'Dans les réglages : les thèmes, la couleur d’accent, le clair ou le sombre, et les mises à jour de Vera.'},
  {title: 'C’est parti', text: 'Fenêtre fermée, Vera reste dans la zone de notification, près de l’horloge. Tu pourras revoir cette visite depuis les réglages.'},
];

const PAD = 8;

export function Tour({close}: {close: () => void}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Steps whose place is not on screen (no collection, no book yet) are left out, once the window is drawn.
  const [steps, setSteps] = useState(STEPS);
  useLayoutEffect(() => setSteps(STEPS.filter(s => !s.target || document.querySelector(s.target))), []);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const last = index >= steps.length - 1;

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector(step.target) : null;
    if (el) el.scrollIntoView({block: 'nearest'});
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step.target]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') last ? close() : setIndex(i => i + 1);
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close, last]);

  // The bubble goes beside its place: to the right of the sidebar, below or above elsewhere, always inside the window.
  const W = 320, vw = window.innerWidth, vh = window.innerHeight;
  let style: React.CSSProperties;
  if (!rect) style = {left: (vw - 400) / 2, top: vh * .28, width: 400};
  else if (rect.right < 300) style = {left: rect.right + PAD + 14, top: Math.min(Math.max(12, rect.top), vh - 230), width: W};
  else {
    const below = rect.bottom + 230 < vh;
    style = {left: Math.min(Math.max(12, rect.left), vw - W - 12), width: W, ...(below ? {top: rect.bottom + PAD + 12} : {top: Math.max(12, rect.top - PAD - 12 - 200)})};
  }
  return <div className="tour" role="dialog" aria-modal="true" aria-label="Visite guidée de Vera">
    {rect ? <div className="tour-hole" style={{left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2}}/>
      : <div className="tour-veil"/>}
    <div className="tour-bubble" style={style} key={index}>
      {!rect && <AppIcon size={56}/>}
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      <div className="tour-foot">
        <span className="tour-dots" aria-label={`Étape ${index + 1} sur ${steps.length}`}>{steps.map((_, i) => <i key={i} className={i === index ? 'on' : ''}/>)}</span>
        {!last && <button className="link" onClick={close}>Passer</button>}
        {index > 0 && <button className="secondary" onClick={() => setIndex(index - 1)}>Retour</button>}
        <button className="primary" autoFocus onClick={() => last ? close() : setIndex(index + 1)}>{last ? 'Commencer' : index === 0 ? 'Visiter' : 'Suivant'}</button>
      </div>
    </div>
  </div>;
}
