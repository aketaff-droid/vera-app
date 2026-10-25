// The sharing assistant (docs/DECISIONS.md, section M): the books, « avec quoi », then the sending — by Vera itself
// for e-mail and a Discord channel, with the guide window for WhatsApp, private Discord messages and other mail
// applications, or a copy on a USB key. Every step can go back; nothing is sent without a last click.
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {api, coverSrc, type Book, type Prepared, type Settings, type SharedFile, type Targets} from '../api';
import {list, plural, size} from '../format';
import {shared} from '../dust/vera';

type Dest = 'mail' | 'discord' | 'discord-dm' | 'whatsapp' | 'mail-other' | 'usb';
type Step = 'books' | 'dest' | 'mail' | 'mail-setup' | 'discord' | 'discord-setup' | 'sending' | 'done';

const MAIL = 25 * 1024 * 1024 * 3 / 4;
const DISCORD = 10 * 1024 * 1024;

interface Props {
  books: Book[];
  settings: Settings;
  close: () => void;
}

export function Share({books: initial, settings, close}: Props) {
  const [books, setBooks] = useState(initial);
  const [step, setStep] = useState<Step>('books');
  const [corrected, setCorrected] = useState(true);
  const [zip, setZip] = useState(false);
  const [dest, setDest] = useState<Dest>(settings.share.mail ? 'mail' : 'whatsapp');
  const [targets, setTargets] = useState<Targets>({whatsapp: true, discord: true});
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{title: string; text: string} | null>(null);
  const share = settings.share;

  useEffect(() => {void api.shareTargets().then(setTargets).catch(() => {});}, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {if (e.key === 'Escape' && !busy) close();};
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, close]);

  const total = books.reduce((s, b) => s + b.size, 0);
  const biggest = books.reduce((m, b) => Math.max(m, b.size), 0);
  const titles = list(books.map(b => b.title));
  const n = books.length;

  async function run<T>(label: string, work: () => Promise<T>): Promise<T | null> {
    setBusy(label); setError(null);
    try {return await work();} catch (e) {setError((e as Error).message); return null;} finally {setBusy(null);}
  }
  const prepare = async () => prepared ?? await run('Préparation des livres…', async () => {
    const p = await api.sharePrepare(books.map(b => b.hash), corrected, zip && n > 1);
    setPrepared(p);
    return p;
  });
  // A change of the books or of the version prepares them again.
  useEffect(() => setPrepared(null), [books, corrected, zip]);

  async function next() {
    if (dest === 'mail') {setStep(share.mail ? 'mail' : 'mail-setup'); return;}
    if (dest === 'discord') {setStep(share.channels.length ? 'discord' : 'discord-setup'); return;}
    const p = await prepare();
    if (!p) return;
    if (dest === 'usb') {
      const where = await run('Enregistrement…', () => api.shareSave(p.files));
      if (where) finish(`${plural(n, 'livre enregistré', 'livres enregistrés')}`, `Dans ${where}.`);
      return;
    }
    const app = dest === 'whatsapp' ? 'whatsapp' : dest === 'discord-dm' ? 'discord' : 'mail';
    await run('Ouverture…', async () => {
      await api.shareCopy(p.files);
      if (app === 'mail') await api.shareOpen('mail', subject(n), body(p.titles));
      else await api.shareOpen(app);
      const query = new URLSearchParams({app, n: String(n), size: size(sumOf(p.files)), h: books.slice(0, 3).map(b => b.hash).join(',')}).toString();
      await api.shareGuideOpen(query, p.files);
      close();
    });
  }

  const finish = (title: string, text: string) => {setDone({title, text}); setStep('done');};
  // Sent: once the confirmation has settled, a copy of each book leaves the window as dust.
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => {
      const box = document.querySelector('.share')?.getBoundingClientRect();
      const thumbs = [...document.querySelectorAll<HTMLElement>('.share-done .fan > *')].map((el, i) => ({hash: books[i]?.hash ?? '', rect: el.getBoundingClientRect()}));
      if (box && thumbs.length) void shared(thumbs, new DOMRect(box.right + 60, thumbs[0]!.rect.top - 40, 0, 0), new Map(books.map(b => [b.hash, b])));
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const order: Step[] = ['books', 'dest'];
  const at = order.includes(step) ? order.indexOf(step) + 1 : 3;

  return <div className="share-layer">
    <button className="share-scrim" aria-label="Fermer le partage" onClick={() => !busy && close()}/>
    <div className="share" role="dialog" aria-label="Partager des livres">
      <div className="share-steps" aria-label="Étapes">
        {['Livres', 'Avec quoi', 'Envoi'].map((label, i) => <span key={label} className={`sstep${i + 1 < at ? ' done' : i + 1 === at ? ' on' : ''}`}>
          <b>{i + 1 < at ? '✓' : i + 1}</b>{label}{i < 2 && <i/>}</span>)}
      </div>

      {step === 'books' && <>
        <Head title="Les livres à partager" sub="Vérifie la sélection avant de choisir comment les envoyer."/>
        <div className="share-body">
          <div className="share-list">{books.map(b => <div key={b.hash} className="share-row">
            <Thumb book={b}/>
            <span className="meta"><b>{b.title}</b><span>{b.authors || 'Auteur inconnu'} · {b.format.toUpperCase()}</span></span>
            <span className="sz">{size(b.size)}</span>
            <button className="x" aria-label={`Retirer ${b.title}`} disabled={n === 1} onClick={() => setBooks(books.filter(x => x.hash !== b.hash))}>✕</button>
          </div>)}</div>
          <div className="seg wide" role="radiogroup" aria-label="Version">
            <button role="radio" aria-checked={corrected} onClick={() => setCorrected(true)}>Version corrigée par Vera</button>
            <button role="radio" aria-checked={!corrected} onClick={() => setCorrected(false)}>Fichiers d’origine</button>
          </div>
          {n > 1 && <div className="share-opt"><span>Regrouper en un seul fichier .zip<small>Une seule pièce jointe : pratique pour l’e-mail.</small></span>
            <button className="switch" role="switch" aria-checked={zip} aria-label="Regrouper en un seul fichier .zip" onClick={() => setZip(!zip)}><span/></button></div>}
        </div>
        <Foot sum={`${plural(n, 'livre', 'livres')} · ${size(total)} · noms lisibles (« Auteur — Titre »)`}>
          <button className="secondary" onClick={close}>Annuler</button>
          <button className="primary" onClick={() => setStep('dest')}>Continuer</button>
        </Foot>
      </>}

      {step === 'dest' && <>
        <Head title="Avec quoi les envoyer ?" sub={`${plural(n, 'livre', 'livres')} · ${size(total)}${zip && n > 1 ? ' · en un seul .zip' : ''}`}/>
        <div className="share-body">
          <div className="dests" role="radiogroup" aria-label="Destination">
            <Tile id="mail" dest={dest} pick={setDest} name="E-mail" icon="mail" color="#d93025" inside
              how={share.mail ? `${share.mail.address}` : 'À relier une fois (2 minutes)'} fit={total <= MAIL ? `✓ ${size(total)} sur 18 Mo` : '✕ Trop lourd pour un e-mail'}/>
            <Tile id="discord" dest={dest} pick={setDest} name="Salon Discord" icon="chat" color="#5865f2" inside
              how={share.channels[0]?.name ?? 'À ajouter une fois'} fit={biggest <= DISCORD ? '✓ Chaque livre sous 10 Mo' : '✕ Un livre dépasse 10 Mo'}/>
            <Tile id="discord-dm" dest={dest} pick={setDest} name="Discord, message privé" icon="chat" color="#5865f2"
              how={targets.discord ? 'Vera t’accompagne pas à pas' : 'Discord n’est pas installé'} disabled={!targets.discord}
              fit={biggest <= DISCORD ? '✓ Chaque livre sous 10 Mo' : '✕ Un livre dépasse 10 Mo'}/>
            <Tile id="whatsapp" dest={dest} pick={setDest} name="WhatsApp" icon="phone" color="#1f9d55"
              how={targets.whatsapp ? 'Vera t’accompagne pas à pas' : 'WhatsApp n’est pas installé'} disabled={!targets.whatsapp} fit="✓ Jusqu’à 2 Go par fichier"/>
            <Tile id="mail-other" dest={dest} pick={setDest} name="Autre messagerie" icon="mail" color="#0a64c8" how="Outlook, Thunderbird… : message ouvert, livres copiés" fit={`✓ ${size(total)}`}/>
            <Tile id="usb" dest={dest} pick={setDest} name="Clé USB ou dossier" icon="box" color="#636366" inside how="Enregistrer une copie" fit={`✓ ${size(total)}`}/>
          </div>
        </div>
        <Foot back={() => setStep('books')} backLabel="Les livres">
          <button className="primary" disabled={!!busy} onClick={() => void next()}>{busy ?? 'Continuer'}</button>
        </Foot>
      </>}

      {step === 'mail-setup' && <MailSetup settings={settings} back={() => setStep('dest')} linked={() => setStep('mail')}/>}
      {step === 'discord-setup' && <DiscordSetup back={() => setStep('dest')} added={() => setStep('discord')} canOpen={targets.discord}/>}

      {step === 'mail' && share.mail && <MailCompose from={share.mail.address} recent={share.recent} n={n} titles={books.map(b => b.title)} books={books}
        relink={() => setStep('mail-setup')} back={() => setStep('dest')} prepare={prepare}
        sent={to => finish(`Envoyé à ${list(to.map(name))}`, `${titles} ${n > 1 ? 'sont partis' : 'est parti'} par e-mail.`)} setBusy={setBusy} setError={setError}/>}

      {step === 'discord' && <DiscordCompose settings={settings} n={n} books={books} back={() => setStep('dest')} add={() => setStep('discord-setup')} prepare={prepare}
        sent={channel => finish(`Envoyé dans ${channel}`, `${titles} ${n > 1 ? 'sont arrivés' : 'est arrivé'} dans le salon.`)} setBusy={setBusy} setError={setError}/>}

      {step === 'done' && done && <>
        <div className="share-done">
          <span className="tick" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
          <h2>{done.title}</h2>
          <p>{done.text}</p>
          <Fan books={books}/>
        </div>
        <Foot><button className="primary" onClick={close}>Terminé</button></Foot>
      </>}

      {(busy || error) && step !== 'dest' && <div className={`share-status${error ? ' warn' : ''}`} role={error ? 'alert' : 'status'}>{error ?? busy}</div>}
      {error && step === 'dest' && <div className="share-status warn" role="alert">{error}</div>}
    </div>
  </div>;
}

const sumOf = (files: SharedFile[]) => files.reduce((s, f) => s + f.size, 0);
/** « Paul » for « paul@exemple.fr », the display name for « Paul Durand <paul@…> ». */
const name = (address: string) => {
  const shown = /^(.+?)\s*<.*>$/.exec(address)?.[1] ?? address.split('@')[0] ?? address;
  return shown.charAt(0).toUpperCase() + shown.slice(1);
};
const subject = (n: number) => n > 1 ? `${n} livres pour toi` : 'Un livre pour toi';
const body = (titles: string[]) => `Bonjour,\n\nVoici ${list(titles, 5)}.\n\nBonne lecture !`;

function Head({title, sub}: {title: string; sub: string}) {
  return <div className="share-head"><h2>{title}</h2><p>{sub}</p></div>;
}

function Foot({children, sum, back, backLabel}: {children: ReactNode; sum?: string; back?: () => void; backLabel?: string}) {
  return <div className="share-foot">
    {back && <button className="link" onClick={back}>‹ {backLabel}</button>}
    <span className="sum">{sum}</span>
    {children}
  </div>;
}

function Thumb({book}: {book: Book}) {
  const src = coverSrc(book.thumb ?? book.cover);
  return src ? <img className="thumb" src={src} alt=""/> : <span className="thumb blank"/>;
}

function Fan({books}: {books: Book[]}) {
  return <div className="fan">{books.slice(0, 3).map(b => <Thumb key={b.hash} book={b}/>)}</div>;
}

function Tile({id, dest, pick, name: label, how, fit, icon, color, inside = false, disabled = false}: {
  id: Dest; dest: Dest; pick: (d: Dest) => void; name: string; how: string; fit: string; icon: 'mail' | 'chat' | 'phone' | 'box'; color: string; inside?: boolean; disabled?: boolean;
}) {
  const no = fit.startsWith('✕');
  return <button className="dest" role="radio" aria-checked={dest === id} disabled={disabled || no} onClick={() => pick(id)}>
    <span className={`tag${inside ? ' in' : ''}`}>{inside ? 'Depuis Vera' : 'Guidé'}</span>
    <span className="dico" style={{background: color}} aria-hidden="true"><DestIcon icon={icon}/></span>
    <b>{label}</b><span className="how">{how}</span>
    <span className={`fit${no ? ' no' : ''}`}>{fit}</span>
  </button>;
}

function DestIcon({icon}: {icon: 'mail' | 'chat' | 'phone' | 'box'}) {
  const p = {width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' as const};
  if (icon === 'mail') return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>;
  if (icon === 'chat') return <svg {...p}><path d="M4 5h16v11H9l-5 4z"/></svg>;
  if (icon === 'phone') return <svg {...p}><path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z"/></svg>;
  return <svg {...p}><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 7h4"/></svg>;
}

/* ——— E-mail ——— */

function MailSetup({settings, back, linked}: {settings: Settings; back: () => void; linked: () => void}) {
  const [address, setAddress] = useState(settings.share.mail?.address ?? '');
  const [server, setServer] = useState(settings.share.mail?.server ?? '');
  const [port, setPort] = useState(settings.share.mail?.port ?? 465);
  const [known, setKnown] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gmail = /@(gmail|googlemail)\.com$/i.test(address.trim());

  useEffect(() => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.trim())) {setKnown(null); return;}
    const t = setTimeout(() => void api.shareMailProvider(address.trim()).then(p => {
      setKnown(!!p);
      if (p) {setServer(p.server); setPort(p.port);}
    }).catch(() => setKnown(false)), 300);
    return () => clearTimeout(t);
  }, [address]);

  async function check() {
    setBusy(true); setError(null);
    try {await api.shareMailSetup({address: address.trim(), server: server.trim(), port}, password); linked();}
    catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  const ready = known !== null && server && password.replace(/\s/g, '').length >= 8;
  return <>
    <Head title="Relier ton adresse e-mail" sub="Une seule fois. Ensuite, Vera envoie tes livres sans te redemander."/>
    <div className="share-body">
      <div className="guide">
        <div className={`gstep${known !== null ? ' ok' : ' now'}`}><span className="gnum">{known !== null ? '✓' : '1'}</span>
          <span className="gt"><b>Ton adresse</b><input className="text" type="email" value={address} onChange={e => setAddress(e.target.value)} placeholder="toi@gmail.com" aria-label="Ton adresse e-mail" autoFocus/></span></div>
        {known === false && <div className="gstep now"><span className="gnum">·</span><span className="gt"><b>Serveur d’envoi</b>
          <small>Vera ne connaît pas cette messagerie : indique son serveur SMTP (voir son aide en ligne).</small>
          <span className="code"><input className="text" value={server} onChange={e => setServer(e.target.value)} placeholder="smtp.exemple.fr" aria-label="Serveur SMTP"/>
            <select value={port} onChange={e => setPort(Number(e.target.value))} aria-label="Port"><option value={465}>465 (SSL)</option><option value={587}>587 (STARTTLS)</option></select></span></span></div>}
        <div className={`gstep${known !== null ? ' now' : ''}`}><span className="gnum">2</span><span className="gt">
          <b>{gmail ? 'Activer la validation en deux étapes sur ton compte Google' : 'Activer la validation en deux étapes de ta messagerie'}</b>
          <small>Nécessaire pour créer un mot de passe d’application. Si elle est déjà active, passe à l’étape suivante.</small>
          {gmail && <span><button className="secondary small" onClick={() => void api.shareOpen('google-two-step')}>Ouvrir la page Google</button></span>}</span></div>
        <div className={`gstep${known !== null ? ' now' : ''}`}><span className="gnum">3</span><span className="gt">
          <b>Créer un mot de passe d’application nommé « Vera »</b>
          <small>{gmail ? 'Google affiche 16 lettres : copie-les.' : 'Dans les réglages de sécurité de ta messagerie.'}</small>
          {gmail && <span><button className="secondary small" onClick={() => void api.shareOpen('google-app-passwords')}>Ouvrir la page Google</button></span>}</span></div>
        <div className={`gstep${known !== null ? ' now' : ''}`}><span className="gnum">4</span><span className="gt" style={{flex: 1}}>
          <b>Colle-le ici</b>
          <span className="code"><input className="text mono" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop" aria-label="Mot de passe d’application"/>
            <button className="primary" disabled={!ready || busy} onClick={() => void check()}>{busy ? 'Vérification…' : 'Vérifier'}</button></span></span></div>
      </div>
      <p className="safe">Gardé dans le Gestionnaire d’identification de Windows, jamais dans un fichier. Révocable à tout moment depuis ton compte.</p>
      {error && <p className="share-status warn" role="alert">{error}</p>}
    </div>
    <Foot back={back} backLabel="Avec quoi"><span/></Foot>
  </>;
}

interface Compose {
  n: number;
  books: Book[];
  back: () => void;
  prepare: () => Promise<Prepared | null>;
  setBusy: (s: string | null) => void;
  setError: (s: string | null) => void;
}

function MailCompose({from, recent, titles, books, n, back, relink, prepare, sent, setBusy, setError}: Compose & {
  from: string; recent: string[]; titles: string[]; relink: () => void; sent: (to: string[]) => void;
}) {
  const [to, setTo] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [subj, setSubj] = useState(subject(n));
  const [text, setText] = useState(body(titles));
  const [sending, setSending] = useState(false);
  const add = (address: string) => {
    const a = address.trim().replace(/[,;]$/, '');
    if (a && !to.some(t => t.toLowerCase() === a.toLowerCase())) setTo([...to, a]);
    setTyped('');
  };
  const valid = (a: string) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(a.replace(/^.*<(.*)>$/, '$1'));
  const all = typed.trim() ? [...to, typed.trim()] : to;
  async function send() {
    setSending(true); setError(null); setBusy('Envoi en cours…');
    try {
      const p = await prepare();
      if (!p) return;
      await api.shareMailSend({to: all, subject: subj, body: text}, p.files);
      sent(all);
    } catch (e) {setError((e as Error).message);} finally {setSending(false); setBusy(null);}
  }
  return <>
    <Head title="Envoyer par e-mail" sub="Envoyé depuis Vera, avec ton adresse."/>
    <div className="share-body">
      <div className="share-list">
        <div className="field"><label>De</label><span>{from}</span><button className="link small" onClick={relink}>Changer</button></div>
        <div className="field"><label>À</label>
          <span className="chips">{to.map(t => <span key={t} className={`chip${valid(t) ? '' : ' bad'}`}>{t}<button aria-label={`Retirer ${t}`} onClick={() => setTo(to.filter(x => x !== t))}>✕</button></span>)}
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={to.length ? '' : 'adresse@exemple.fr'} aria-label="Destinataire"
              onKeyDown={e => {if (['Enter', ',', ';'].includes(e.key)) {e.preventDefault(); add(typed);}}} onBlur={() => typed && add(typed)} autoFocus/></span></div>
        <div className="field"><label>Objet</label><input value={subj} onChange={e => setSubj(e.target.value)} aria-label="Objet"/></div>
      </div>
      {recent.length > 0 && <div className="recent">Récents :{recent.slice(0, 5).map(r => <button key={r} onClick={() => add(r)}>{name(r)}</button>)}</div>}
      <textarea className="msg" value={text} onChange={e => setText(e.target.value)} aria-label="Message"/>
      <div className="atts">{books.map(b => <span key={b.hash} className="att"><Thumb book={b}/>{b.title}<span className="note">· {size(b.size)}</span></span>)}</div>
    </div>
    <Foot back={back} backLabel="Avec quoi" sum={`${size(books.reduce((s, b) => s + b.size, 0))} sur 18 Mo`}>
      <button className="primary" disabled={sending || !all.length || !all.every(valid)} onClick={() => void send()}>{sending ? 'Envoi…' : 'Envoyer'}</button>
    </Foot>
  </>;
}

/* ——— Discord channel ——— */

function DiscordSetup({back, added, canOpen}: {back: () => void; added: () => void; canOpen: boolean}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setBusy(true); setError(null);
    try {await api.shareDiscordAdd(label, url); added();} catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <>
    <Head title="Ajouter un salon Discord" sub="Une seule fois par salon. Il faut pouvoir gérer ce salon (ton serveur, ou un serveur où tu es modérateur)."/>
    <div className="share-body">
      <div className="guide">
        <div className="gstep now"><span className="gnum">1</span><span className="gt"><b>Dans Discord, ouvre les paramètres du salon</b>
          <small>Roue dentée à côté du nom du salon › Intégrations › Webhooks › Nouveau webhook.</small>
          {canOpen && <span><button className="secondary small" onClick={() => void api.shareOpen('discord')}>Ouvrir Discord</button></span>}</span></div>
        <div className="gstep now"><span className="gnum">2</span><span className="gt"><b>Nomme-le « Vera », puis « Copier l’URL du webhook »</b><small>Une adresse qui commence par https://discord.com/api/webhooks/</small></span></div>
        <div className="gstep now"><span className="gnum">3</span><span className="gt" style={{flex: 1}}><b>Colle-la ici, et donne un nom au salon</b>
          <input className="text mono" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" aria-label="Adresse du webhook"/>
          <input className="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="#livres · Serveur des amis" aria-label="Nom du salon"/></span></div>
      </div>
      <p className="safe">L’adresse est gardée dans le Gestionnaire d’identification de Windows. Supprimer le webhook dans Discord la rend inutilisable.</p>
      {error && <p className="share-status warn" role="alert">{error}</p>}
    </div>
    <Foot back={back} backLabel="Avec quoi"><button className="primary" disabled={busy || !url || !label.trim()} onClick={() => void add()}>{busy ? 'Ajout…' : 'Ajouter'}</button></Foot>
  </>;
}

function DiscordCompose({settings, books, n, back, add, prepare, sent, setBusy, setError}: Compose & {settings: Settings; add: () => void; sent: (channel: string) => void}) {
  const channels = settings.share.channels;
  const [id, setId] = useState(channels[0]?.id ?? '');
  const [message, setMessage] = useState(n > 1 ? `${n} livres pour vous 📚` : 'Un livre pour vous 📚');
  const [sending, setSending] = useState(false);
  const channel = useMemo(() => channels.find(c => c.id === id), [channels, id]);
  async function send() {
    if (!channel) return;
    setSending(true); setError(null); setBusy('Envoi en cours…');
    try {
      const p = await prepare();
      if (!p) return;
      await api.shareDiscordSend(channel.id, message, p.files);
      sent(channel.name);
    } catch (e) {setError((e as Error).message);} finally {setSending(false); setBusy(null);}
  }
  return <>
    <Head title="Envoyer dans un salon Discord" sub="Envoyé depuis Vera, dans un salon où tu as ajouté Vera."/>
    <div className="share-body">
      <div className="share-list">
        <div className="field"><label>Salon</label><span className="chips">{channels.map(c =>
          <button key={c.id} className={`chip${c.id === id ? ' on' : ''}`} aria-pressed={c.id === id} onClick={() => setId(c.id)}>{c.name}</button>)}</span>
          <button className="link small" onClick={add}>Autre salon…</button></div>
        <div className="field"><label>Message</label><input value={message} onChange={e => setMessage(e.target.value)} aria-label="Message"/></div>
      </div>
      <div className="atts">{books.map(b => <span key={b.hash} className="att"><Thumb book={b}/>{b.title}<span className="note">· {size(b.size)}</span></span>)}</div>
    </div>
    <Foot back={back} backLabel="Avec quoi" sum="Chaque livre doit faire moins de 10 Mo">
      <button className="primary" disabled={sending || !channel} onClick={() => void send()}>{sending ? 'Envoi…' : 'Envoyer'}</button>
    </Foot>
  </>;
}
