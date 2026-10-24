// Browser preview only (`npm run dev`): a stand-in for Vera's engine with sample books, never part of the
// application. Scenarios by URL: ?s=onboarding | drive | full | broken | empty | low (Kobo nearly full),
// and ?accent=blue&mode=dark, ?theme=papier.
// window.vera.plug() simulates a Kobo being plugged in.
import type {AppState, Book, Detail, Highlight, KoboState, Library, Metadata, Reading, Report, Settings, Step} from '../api';
// Sample files for the reader: the test fixtures (a fictitious corpus, no real book).
import sampleEpub from '../../tests/fixtures/representative.epub?url';
import samplePdf from '../../tests/fixtures/sample.pdf?url';

const covers = import.meta.glob('./covers/*.jpg', {eager: true, query: '?url', import: 'default'}) as Record<string, string>;
const cover = (name: string) => covers[`./covers/${name}.jpg`] ?? null;
// Cover colours as vera-core computes them (cover.rs).
const tints: Record<string, string[]> = {"around-the-world-in-eighty-days": ["#676b49", "#1d2218"], "dracula": ["#4a5253", "#292720"], "frankenstein": ["#a65d3e", "#280e1b"], "germinal": ["#8e6c4b", "#3e2e22"], "les-miserables": ["#7c5539", "#42342a"], "madame-bovary": ["#9c877b", "#5a5654"], "the-count-of-monte-cristo": ["#86201e", "#1c1c17"], "the-three-musketeers": ["#62411c", "#1a150b"], "the-time-machine": ["#897c65", "#171416"], "the-war-of-the-worlds": ["#c9994e", "#473723"], "le-horla": ["#1c2b4f", "#1b2a4e"]};
const params = new URLSearchParams(location.search);
const highlights = new Map<string, Highlight[]>();
const scenario = params.get('s') ?? '';

const MB = 1024 * 1024;
const raw: [string, string, string | null, string, number, boolean, ('epub' | 'pdf')?, boolean?][] = [
  ['Madame Bovary', 'Gustave Flaubert', 'Classiques', 'madame-bovary', 1.2, false],
  ['Germinal', 'Émile Zola', 'Classiques', 'germinal', 1.8, false],
  ['Les Misérables', 'Victor Hugo', 'Classiques', 'les-miserables', 3.1, false],
  ['Les Trois Mousquetaires', 'Alexandre Dumas', 'Classiques › Dumas', 'the-three-musketeers', 2.2, false],
  ['Le Comte de Monte-Cristo', 'Alexandre Dumas', 'Classiques › Dumas', 'the-count-of-monte-cristo', 2.6, true],
  ['Le Tour du monde en 80 jours', 'Jules Verne', 'Science-fiction', 'around-the-world-in-eighty-days', 1.1, false],
  ['La Machine à explorer le temps', 'H. G. Wells', 'Science-fiction › Wells', 'the-time-machine', 0.8, false],
  ['La Guerre des mondes', 'H. G. Wells', 'Science-fiction › Wells', 'the-war-of-the-worlds', 1.4, true],
  ['Dracula', 'Bram Stoker', 'Gothique', 'dracula', 1.5, false],
  ['Frankenstein', 'Mary Shelley', 'Gothique', 'frankenstein', 0.9, true],
  // A cover drawn by Vera (cover.rs), and the same Monte-Cristo again as a PDF: a probable duplicate.
  ['Le Horla', 'Guy de Maupassant', 'Gothique', 'le-horla', 0.3, false, 'epub', true],
  ['Le Comte de Monte-Cristo', 'Dumas, Alexandre', null, 'the-count-of-monte-cristo', 6.4, false, 'pdf'],
];
const twins = [['h4'.padEnd(64, '0'), 'h11'.padEnd(64, '0')]];
let books: Book[] = scenario === 'empty' ? [] : raw.map(([title, authors, collection, file, mo, fresh, format = 'epub', made = false], i) => ({
  hash: `h${i}`.padEnd(64, '0'), title, authors, format, size: Math.round(mo * MB), path: `G:\\Mon Drive\\Livres\\${collection ? `${collection.replaceAll(' › ', '\\')}\\` : ''}${title}.${format}`,
  collection, cover: cover(file), thumb: cover(file), tint: tints[file] ?? [], madeCover: made, read: i === 0 ? 0.34 : null,
  kobo: i === 2 ? {percent: 62, status: 1} : i === 1 ? {percent: 100, status: 2} : null, notes: i === 2 ? 3 : 0, twin: twins[0]!.includes(`h${i}`.padEnd(64, '0')), addedAt: fresh ? 1_792_600_000 + i : 1_790_000_000 + i, problem: scenario === 'broken' && i === 1 ? 'L’archive s’arrête avant la fin.' : null, edited: false,
}));
const fresh = new Set(raw.flatMap((r, i) => r[5] ? [`h${i}`.padEnd(64, '0')] : []));

function collections(): Library['collections'] {
  const names = [...new Set(books.flatMap(b => {
    const parts = b.collection?.split(' › ') ?? [];
    return parts.map((_, i) => parts.slice(0, i + 1).join(' › '));
  }))].sort();
  return names.map(name => ({name, label: name.split(' › ').pop() ?? name, parent: name.includes(' › ') ? name.slice(0, name.lastIndexOf(' › ')) : null,
    count: books.filter(b => b.collection === name).length, total: books.filter(b => b.collection === name || b.collection?.startsWith(`${name} › `)).length}));
}

const settings: Settings = {watchDir: scenario === 'onboarding' ? null : 'G:\\Mon Drive\\Livres', autostart: true, koboSync: true,
  accent: (params.get('accent') as Settings['accent']) ?? (params.get('theme') ? 'maison' : 'orange'), theme: (params.get('theme') as Settings['theme']) ?? 'vera', appearance: (params.get('mode') as Settings['appearance']) ?? 'light', replaceEdited: false, onboarded: scenario !== 'onboarding', toured: !params.get('tour'),
  reader: {size: 19, theme: (params.get('reader') as Settings['reader']['theme']) ?? 'papier', font: 'serif'},
  // ?share=linked: an address and a Discord channel already linked.
  share: params.get('share') === 'linked'
    ? {mail: {address: 'toi@gmail.com', server: 'smtp.gmail.com', port: 465}, channels: [{id: 'c1', name: '#livres · Serveur des amis'}], recent: ['paul@exemple.fr', 'lea@exemple.fr']}
    : {mail: null, channels: [], recent: []}};
let waiting = scenario === 'empty' ? [] : [...fresh];
const kobo: KoboState = {device: null, syncing: false, step: null, report: null, error: null, ejecting: false, ejected: false};
const state = (): AppState => ({settings, folder: {error: scenario === 'drive' ? 'G:\\Mon Drive\\Livres est introuvable.' : null, reading: null, last: {added: 0, placed: 0, forgotten: 0, waiting: 0, total: books.length}},
  kobo, waiting, deviceKnown: true, lastSyncAt: 1_792_500_000, lastFree: scenario === 'low' ? 3 * MB : 2.1 * 1024 * MB,
  // ?update=1: a new version waiting.
  update: params.get('update') ? {version: '2.5.0', notes: 'Progression et notes de la Kobo dans Vera, mises à jour depuis Vera.'} : null, dataDir: 'C:\\Users\\toi\\AppData\\Roaming\\fr.vera.personal'});
const edits = new Map<string, {metadata: Metadata; revision: number}>();
const dismissed = new Set<string>();
const places = new Map<string, Reading>();
const sentEntry = (at: number, titles: string[], extra: Partial<Report> = {}): Report => ({device: 'kobo', model: 'Kobo Clara Colour', at, present: 8, resent: 0, removable: [], missingBytes: 0,
  freeBytes: 2.1 * 1024 * MB, shelves: {created: 0, added: titles.length, removed: 0, shelvesRemoved: 0, waiting: 0, backup: null}, shelvesError: null,
  results: titles.map((title, i) => ({hash: `j${at}${i}`, title, outcome: 'copied', bytes: MB, detail: null})), ...extra});
const journal: Report[] = [
  sentEntry(1_792_500_000, ['Germinal', 'Dracula']),
  sentEntry(1_792_100_000, []),
  sentEntry(1_791_700_000, ['Les Misérables'], {results: [{hash: 'x', title: 'Les Misérables', outcome: 'copied', bytes: MB, detail: null}, {hash: 'y', title: 'Atlas illustré', outcome: 'noSpace', bytes: 0, detail: null}], missingBytes: 180 * MB, freeBytes: 40 * MB}),
];

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const emit = (event: string, payload?: unknown) => handlers.get(event)?.forEach(h => h(payload));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const original = (b: Book): Metadata => ({title: b.title, authors: b.authors, language: 'fr', isbn: null, publisher: '', published: '', subjects: [], description: ''});

async function plug() {
  if (kobo.device) return;
  Object.assign(kobo, {device: {id: 'kobo', firmware: '4.45', model: 'Kobo Clara Colour'}, ejected: false, report: null, error: null});
  emit('kobo', {...kobo});
  await wait(900);
  kobo.syncing = true;
  const todo = books.filter(b => waiting.includes(b.hash) && !b.problem);
  const full = scenario === 'full';
  const report: Report = {device: 'kobo', model: 'Kobo Clara Colour', at: Math.floor(Date.now() / 1000), results: [], present: books.length - todo.length, resent: 0,
    // ?s=mirror: two converted PDFs left the folder yesterday.
    removable: scenario === 'mirror' ? [
      {hash: 'p1', title: 'Germinal (PDF)', authors: 'Émile Zola', relative: 'Vera/p1.pdf', size: 6.2 * MB, leftAt: Math.floor(Date.now() / 1000) - 90_000, percent: 45, notes: 4},
      {hash: 'p2', title: 'Madame Bovary (PDF)', authors: 'Gustave Flaubert', relative: 'Vera/p2.pdf', size: 4.8 * MB, leftAt: Math.floor(Date.now() / 1000) - 88_000, percent: null, notes: 0},
    ] : [],
    missingBytes: 0, freeBytes: Math.round(3.1 * 1024 * MB), shelves: {created: 0, added: 0, removed: 0, shelvesRemoved: 0, waiting: todo.length, backup: null}, shelvesError: null};
  for (const [index, book] of todo.entries()) {
    if (full && index > 0) {report.results.push({hash: book.hash, title: book.title, outcome: 'noSpace', bytes: 0, detail: null}); report.missingBytes += book.size; continue;}
    for (let done = 0; done <= book.size; done += book.size / 14) {
      kobo.step = {stage: 'sending', index, total: todo.length, title: book.title, done: Math.min(done, book.size), size: book.size} satisfies Step;
      emit('kobo', {...kobo});
      await wait(60);
    }
    report.results.push({hash: book.hash, title: book.title, outcome: 'copied', bytes: book.size, detail: null});
    waiting = waiting.filter(h => h !== book.hash);
  }
  kobo.step = {stage: 'shelves'};
  emit('kobo', {...kobo});
  await wait(800);
  Object.assign(kobo, {syncing: false, step: null, report});
  emit('kobo', {...kobo});
}

declare global { interface Window { vera?: {plug: () => Promise<void>; unplug: () => void} } }
window.vera = {plug, unplug: () => {Object.assign(kobo, {device: null, ejected: false}); emit('kobo', {...kobo});}};

export const mock = {
  listen(event: string, handler: Handler) {
    const set = handlers.get(event) ?? new Set();
    set.add(handler);
    handlers.set(event, set);
    return () => set.delete(handler);
  },
  async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (cmd) {
      case 'state': return state();
      case 'library': return {books: books.map(b => ({...b, title: edits.get(b.hash)?.metadata.title ?? b.title, edited: edits.has(b.hash)})), collections: collections(),
        twins: twins.filter(g => !dismissed.has(g.join()))} satisfies Library;
      case 'dismiss_twins': dismissed.add((args.hashes as string[]).join()); emit('library'); return;
      case 'journal': return journal;
      case 'book_file': {
        const b = books.find(x => x.hash === args.hash);
        return (await fetch(b?.format === 'pdf' ? samplePdf : sampleEpub)).arrayBuffer();
      }
      case 'share_prepare': {
        const chosen = books.filter(b => (args.hashes as string[]).includes(b.hash));
        const files = chosen.map(b => ({path: `C:\\Vera\\partage\\${b.title}.${b.format}`, name: `${b.authors.split(' · ')[0]} — ${b.title}.${b.format}`, size: b.size}));
        await wait(500);
        return args.zip && files.length > 1 ? {dir: 'C:\\Vera\\partage', files: [{path: 'C:\\Vera\\partage\\x.zip', name: `${files.length} livres.zip`, size: files.reduce((s, f) => s + f.size, 0)}], titles: chosen.map(b => b.title)}
          : {dir: 'C:\\Vera\\partage', files, titles: chosen.map(b => b.title)};
      }
      case 'kobo_remove': {
        await wait(700);
        const gone = args.hashes as string[];
        if (kobo.report) kobo.report = {...kobo.report, removable: kobo.report.removable.filter(r => !gone.includes(r.hash))};
        emit('kobo', {...kobo});
        return gone.length;
      }
      case 'highlights': return [...(highlights.get(args?.hash as string) ?? [])];
      case 'save_highlight': {
        const list = highlights.get(args?.hash as string) ?? [];
        const h = {...(args?.highlight as Highlight), created: (args?.highlight as Highlight).created || Date.now() / 1000};
        highlights.set(args?.hash as string, [...list.filter(x => x.id !== h.id), h].sort((a, b) => a.fraction - b.fraction));
        return h;
      }
      case 'delete_highlight': highlights.set(args?.hash as string, (highlights.get(args?.hash as string) ?? []).filter(x => x.id !== args?.id)); return;
      case 'annotations': return [
        {text: 'Il y a des hommes qui observent une loi d’honneur, comme on observe une étoile.', note: '', progress: 0.12, created: '2026-10-20T21:04:00Z'},
        {text: 'On ne doit jamais dire d’un homme qu’il n’a plus d’espoir.', note: 'À relire avec Paul', progress: 0.41, created: '2026-10-21T22:10:00Z'},
        {text: 'Aimer, c’est agir.', note: '', progress: 0.58, created: '2026-10-22T20:31:00Z'},
      ];
      case 'export_annotations': await wait(300); return 'C:\\Users\\toi\\Documents\\notes.md';
      case 'update_check': await wait(600); return params.get('update') ? {version: '2.5.0', notes: null} : null;
      case 'update_install':
        for (let done = 0; done <= 14; done++) {emit('update-progress', [done * MB, 14 * MB]); await wait(120);}
        return;
      case 'share_targets': return {whatsapp: true, discord: params.get('discord') !== 'none'};
      case 'share_mail_provider': return /@(gmail|googlemail)\.com$/i.test(String(args.address)) ? {address: args.address, server: 'smtp.gmail.com', port: 465} : null;
      case 'share_mail_setup': await wait(900); settings.share = {...settings.share, mail: args.account as Settings['share']['mail']}; emit('settings', {...settings}); return {...settings};
      case 'share_mail_forget': settings.share = {...settings.share, mail: null}; emit('settings', {...settings}); return {...settings};
      case 'share_mail_send': await wait(1400); settings.share = {...settings.share, recent: [...(args.mail as {to: string[]}).to, ...settings.share.recent].slice(0, 12)}; emit('settings', {...settings}); return;
      case 'share_discord_add': await wait(400); settings.share = {...settings.share, channels: [...settings.share.channels, {id: `c${Date.now()}`, name: String(args.name)}]}; emit('settings', {...settings}); return {...settings};
      case 'share_discord_remove': settings.share = {...settings.share, channels: settings.share.channels.filter(c => c.id !== args.id)}; emit('settings', {...settings}); return {...settings};
      case 'share_discord_send': await wait(1200); return;
      case 'share_copy': case 'share_open': case 'share_reveal': case 'share_guide_recopy': return;
      case 'share_save': await wait(300); return 'E:\\Livres';
      case 'share_guide_open': window.open(`/?guide=1&${args.query as string}`, 'guide', 'width=360,height=600'); return;
      case 'share_guide_close': window.close(); return;
      case 'reading_position': return places.get(args.hash as string) ?? null;
      case 'save_reading': places.set(args.hash as string, {position: args.position as string, fraction: args.fraction as number, at: Date.now() / 1000}); return;
      case 'detail': {
        const b = books.find(x => x.hash === args.hash);
        if (!b) throw new Error('Livre introuvable.');
        const e = edits.get(b.hash);
        return {book: {...b, edited: !!e}, original: original(b), metadata: e?.metadata ?? original(b), revision: e?.revision ?? 0} satisfies Detail;
      }
      case 'save_card': {
        const hash = args.hash as string;
        const revision = (edits.get(hash)?.revision ?? 0) + 1;
        edits.set(hash, {metadata: args.metadata as Metadata, revision});
        emit('library');
        return revision;
      }
      case 'lookup':
        await wait(700);
        if (!/^[\d-]{10,17}X?$/i.test(String(args.isbn))) throw new Error('ISBN invalide : vérifie ses chiffres sur la fiche avant la recherche.');
        return {title: null, authors: null, publisher: 'Le Livre de Poche', published: '1998', description: null, subjects: null, url: 'https://openlibrary.org/books/OL1M', warnings: []};
      case 'save_settings': {
        const next = args.settings as Settings;
        if (next.watchDir && !settings.watchDir) {
          Object.assign(settings, next);
          const total = books.length || 412;
          for (let done = 0; done <= total; done += 6) {emit('folder', {error: null, reading: [Math.min(done, total), total], last: null}); await wait(40);}
          emit('folder', {error: null, reading: null, last: {added: total, placed: 0, forgotten: 0, waiting: 0, total}});
        }
        Object.assign(settings, next);
        emit('settings', {...settings});
        return {...settings};
      }
      case 'choose_folder': return 'D:\\Livres';
      case 'suggest_folder': return {path: 'G:\\Mon Drive\\Livres', books: 412, drive: true};
      case 'sync_now': return plug();
      case 'eject':
        Object.assign(kobo, {ejecting: true}); emit('kobo', {...kobo}); await wait(900);
        Object.assign(kobo, {ejecting: false, ejected: true}); emit('kobo', {...kobo});
        setTimeout(() => window.vera?.unplug(), 3000);
        return;
      default: return;
    }
  },
};
if (params.get('kobo') === 'plug') setTimeout(() => void plug(), 600);
books = books.sort((a, b) => b.addedAt - a.addedAt);
