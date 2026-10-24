// What the interface knows of Vera's engine (vera-core, through the commands of src-tauri/src/commands.rs).
// Outside Tauri — the browser preview of `npm run dev` — a mock with sample books stands in (src/dev/mock.ts).
import {invoke as tauriInvoke, convertFileSrc} from '@tauri-apps/api/core';
import {listen as tauriListen} from '@tauri-apps/api/event';

export type Accent = 'maison' | 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'graphite';
export type Appearance = 'auto' | 'light' | 'dark';
export type ThemeId = 'vera' | 'papier' | 'citadelle' | 'encre' | 'reflet';

export interface Settings {
  watchDir: string | null;
  autostart: boolean;
  koboSync: boolean;
  accent: Accent;
  theme: ThemeId;
  appearance: Appearance;
  replaceEdited: boolean;
  onboarded: boolean;
  /** The guided start was shown (or skipped). */
  toured: boolean;
  reader: ReaderSettings;
  share: ShareSettings;
}

/** A passage highlighted in Vera's reader; kept in Vera's catalogue only. */
export type HighlightColor = 'jaune' | 'vert' | 'bleu' | 'rose';
export interface Highlight {id: string; position: string; text: string; color: HighlightColor; note: string; fraction: number; created: number}
export interface UpdateInfo {version: string; notes: string | null}
export interface MailAccount {address: string; server: string; port: number}
export interface Channel {id: string; name: string}
/** The mail account and Discord channels (their secrets stay in Windows' credential store) and recent recipients. */
export interface ShareSettings {mail: MailAccount | null; channels: Channel[]; recent: string[]}
export interface SharedFile {path: string; name: string; size: number}
export interface Prepared {dir: string; files: SharedFile[]; titles: string[]}
export interface Mail {to: string[]; subject: string; body: string}
export interface Targets {whatsapp: boolean; discord: boolean}

export type ReaderTheme = 'blanc' | 'papier' | 'calme' | 'nuit';
export interface ReaderSettings {size: number; theme: ReaderTheme; font: 'serif' | 'sans'}
/** Where the reader left a book: a CFI for an EPUB, « page:N » for a PDF, and how far it is (0 to 1). */
export interface Reading {position: string; fraction: number; at: number}

export interface Metadata {
  title: string;
  authors: string;
  language: string;
  isbn: string | null;
  publisher: string;
  published: string;
  subjects: string[];
  description: string;
}

export interface Book {
  hash: string;
  title: string;
  authors: string;
  format: 'epub' | 'pdf';
  size: number;
  path: string;
  collection: string | null;
  cover: string | null;
  /** Light copy of the cover for grids; null until made. */
  thumb: string | null;
  /** The cover's colours: vivid, then deep. */
  tint: string[];
  madeCover: boolean;
  /** Another book has the same title and authors (probable duplicate). */
  twin: boolean;
  /** How far it has been read in Vera (0 to 1); null if never opened there. */
  read: number | null;
  /** Where it is on the Kobo, as the liseuse last said: percent 0–100, status 0 not started, 1 reading, 2 finished. */
  kobo: {percent: number; status: number} | null;
  /** Highlights and notes made on the Kobo, kept in Vera. */
  notes: number;
  addedAt: number;
  problem: string | null;
  edited: boolean;
}

export interface Collection {name: string; label: string; parent: string | null; count: number; total: number}
export interface Library {books: Book[]; collections: Collection[]; twins: string[][]}
export interface Detail {book: Book; original: Metadata; metadata: Metadata; revision: number}

export interface Pass {added: number; placed: number; forgotten: number; waiting: number; total: number}
export interface FolderState {error: string | null; reading: [number, number] | null; last: Pass | null}

export type Step =
  | {stage: 'reading'}
  | {stage: 'sending'; index: number; total: number; title: string; done: number; size: number}
  | {stage: 'shelves'};

export type Outcome = 'copied' | 'updated' | 'noSpace' | 'failed';
export interface Sent {hash: string; title: string; outcome: Outcome; bytes: number; detail: string | null}
export interface ShelfReport {created: number; added: number; removed: number; shelvesRemoved: number; waiting: number; backup: string | null}
export interface Report {
  device: string; model: string; at: number; results: Sent[]; present: number; resent: number; removable: Removable[];
  missingBytes: number; freeBytes: number; shelves: ShelfReport | null; shelvesError: string | null;
}
/** Vera's copy of a book that left the folder a day ago or more: removed from the Kobo only if the owner confirms. */
export interface Removable {hash: string; title: string; authors: string; relative: string; size: number; leftAt: number; percent: number | null; notes: number}
export interface Annotation {text: string; note: string; progress: number; created: string}
export interface Device {id: string; firmware: string; model: string}
export interface KoboState {
  device: Device | null; syncing: boolean; step: Step | null; report: Report | null;
  error: string | null; ejecting: boolean; ejected: boolean;
}

export interface AppState {
  settings: Settings;
  folder: FolderState;
  kobo: KoboState;
  waiting: string[];
  deviceKnown: boolean;
  lastSyncAt: number | null;
  /** Free space on that Kobo at its last synchronisation. */
  lastFree: number | null;
  /** A new version of Vera waiting to be installed. */
  update: UpdateInfo | null;
  dataDir: string;
}

export interface Found {
  title: string | null; authors: string | null; publisher: string | null; published: string | null;
  description: string | null; subjects: string[] | null; url: string; warnings: string[];
}
export interface Suggestion {path: string; books: number; drive: boolean}

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Mock = {invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>; listen: (event: string, handler: (payload: unknown) => void) => () => void};
let mock: Promise<Mock> | null = null;
function dev(): Promise<Mock> {
  // Tree-shaken from the application: import.meta.env.DEV is false in a build.
  if (import.meta.env.DEV) return mock ??= import('./dev/mock').then(m => m.mock);
  return Promise.reject(new Error('Vera doit être ouverte par son application.'));
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    if (inTauri) return await tauriInvoke<T>(cmd, args);
    return (await (await dev()).invoke(cmd, args)) as T;
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Erreur inattendue.');
  }
}

export function listen<T>(event: string, handler: (payload: T) => void): () => void {
  if (inTauri) {
    const off = tauriListen<T>(event, e => handler(e.payload));
    return () => void off.then(f => f());
  }
  let stop = () => {};
  let stopped = false;
  void dev().then(m => {if (!stopped) stop = m.listen(event, p => handler(p as T));});
  return () => {stopped = true; stop();};
}

export const coverSrc = (path: string | null) => path === null ? null : inTauri ? convertFileSrc(path) : path;

export const api = {
  state: () => call<AppState>('state'),
  library: () => call<Library>('library'),
  detail: (hash: string) => call<Detail>('detail', {hash}),
  saveCard: (hash: string, metadata: Metadata, revision: number) => call<number>('save_card', {hash, metadata, revision}),
  lookup: (isbn: string) => call<Found>('lookup', {isbn}),
  saveSettings: (settings: Settings) => call<Settings>('save_settings', {settings}),
  chooseFolder: () => call<string | null>('choose_folder'),
  suggestFolder: () => call<Suggestion | null>('suggest_folder'),
  syncNow: () => call<void>('sync_now'),
  eject: () => call<void>('eject'),
  koboRemove: (hashes: string[]) => call<number>('kobo_remove', {hashes}),
  updateCheck: () => call<UpdateInfo | null>('update_check'),
  updateInstall: () => call<void>('update_install'),
  reveal: (hash: string) => call<void>('reveal', {hash}),
  openFolder: () => call<void>('open_folder'),
  openData: () => call<void>('open_data'),
  dismissTwins: (hashes: string[]) => call<void>('dismiss_twins', {hashes}),
  journal: () => call<Report[]>('journal'),
  annotations: (hash: string) => call<Annotation[]>('annotations', {hash}),
  highlights: (hash: string) => call<Highlight[]>('highlights', {hash}),
  saveHighlight: (hash: string, highlight: Highlight) => call<Highlight>('save_highlight', {hash, highlight}),
  deleteHighlight: (hash: string, id: string) => call<void>('delete_highlight', {hash, id}),
  exportAnnotations: (hash: string, title: string, authors: string) => call<string | null>('export_annotations', {hash, title, authors}),
  bookFile: (hash: string) => call<ArrayBuffer>('book_file', {hash}),
  readingPosition: (hash: string) => call<Reading | null>('reading_position', {hash}),
  saveReading: (hash: string, position: string, fraction: number) => call<void>('save_reading', {hash, position, fraction}),
  sharePrepare: (hashes: string[], corrected: boolean, zip: boolean) => call<Prepared>('share_prepare', {hashes, corrected, zip}),
  shareTargets: () => call<Targets>('share_targets'),
  shareMailProvider: (address: string) => call<MailAccount | null>('share_mail_provider', {address}),
  shareMailSetup: (account: MailAccount, password: string) => call<Settings>('share_mail_setup', {account, password}),
  shareMailForget: () => call<Settings>('share_mail_forget'),
  shareMailSend: (mail: Mail, files: SharedFile[]) => call<void>('share_mail_send', {mail, files}),
  shareDiscordAdd: (name: string, url: string) => call<Settings>('share_discord_add', {name, url}),
  shareDiscordRemove: (id: string) => call<Settings>('share_discord_remove', {id}),
  shareDiscordSend: (id: string, message: string, files: SharedFile[]) => call<void>('share_discord_send', {id, message, files}),
  shareCopy: (files: SharedFile[]) => call<void>('share_copy', {files}),
  shareOpen: (target: 'whatsapp' | 'discord' | 'mail' | 'google-app-passwords' | 'google-two-step', subject?: string, body?: string) =>
    call<void>('share_open', {target, subject: subject ?? null, body: body ?? null}),
  shareReveal: (files: SharedFile[]) => call<void>('share_reveal', {files}),
  shareSave: (files: SharedFile[]) => call<string | null>('share_save', {files}),
  shareGuideOpen: (query: string, files: SharedFile[]) => call<void>('share_guide_open', {query, files}),
  shareGuideRecopy: () => call<void>('share_guide_recopy'),
  shareGuideClose: () => call<void>('share_guide_close'),
};

/// The command names the interface uses; tests/check-interface.mjs checks each is registered in src-tauri.
export const COMMANDS = ['state', 'library', 'detail', 'save_card', 'lookup', 'save_settings', 'choose_folder', 'suggest_folder', 'sync_now', 'eject', 'kobo_remove', 'update_status', 'update_check', 'update_install', 'reveal', 'open_folder', 'open_data', 'dismiss_twins', 'journal', 'annotations', 'highlights', 'save_highlight', 'delete_highlight', 'export_annotations', 'book_file', 'reading_position', 'save_reading',
  'share_prepare', 'share_targets', 'share_mail_provider', 'share_mail_setup', 'share_mail_forget', 'share_mail_send', 'share_discord_add', 'share_discord_remove',
  'share_discord_send', 'share_copy', 'share_open', 'share_reveal', 'share_save', 'share_guide_open', 'share_guide_recopy', 'share_guide_close'];
