// Where Vera's moments find their material and their places on screen (docs/DECISIONS.md, section Q). Each function
// reads the interface as it is now, starts its moment and returns; nothing here changes a book, a file or the Kobo.
import * as Stage from './stage';
import * as M from './moments';
import type {Book} from '../api';

const centre = (r: {x: number; y: number; width: number; height: number}) => ({x: r.x + r.width / 2, y: r.y + r.height / 2});
const root = () => document.documentElement.classList;

/** The covers on screen, with their pictures: the opening and the dream are made of them. */
async function visibleCovers(books: Map<string, Book>, max = 24): Promise<M.Source[]> {
  const tiles = [...document.querySelectorAll<HTMLElement>('.content [data-book]')]
    .map(el => ({hash: el.dataset.book!, rect: Stage.onScreen(el.querySelector('.cover'))}))
    .filter((t): t is {hash: string; rect: DOMRect} => !!t.rect).slice(0, max);
  const pictures = await Stage.picturesOf(tiles.map(t => t.hash));
  return tiles.map(t => ({rect: t.rect, picture: pictures.get(t.hash) ?? null, tint: books.get(t.hash)?.tint}));
}

/** The opening: full the first time of the day, short after. */
export async function opening(books: Map<string, Book>) {
  if (!Stage.enabled()) return;
  const day = new Date().toDateString();
  let short = false;
  try {short = localStorage.getItem('vera.opened') === day; localStorage.setItem('vera.opened', day);} catch {/* full every time then */}
  // The veil and the hidden covers come before the first paint; the pictures are asked for meanwhile.
  root().add('dust-opening');
  const veil = document.querySelector<HTMLElement>('.dust-veil');
  if (veil) veil.style.opacity = '1';
  const sources = await visibleCovers(books);
  // Turned off meanwhile: the library comes back as it is.
  if (!Stage.enabled()) {root().remove('dust-opening'); if (veil) veil.style.opacity = '0'; return;}
  const content = Stage.onScreen(document.querySelector('.content')) ?? new DOMRect(0, 0, innerWidth, innerHeight);
  Stage.play(M.opening({sources, centre: {x: content.x + content.width / 2, y: Math.min(innerHeight * .45, content.y + content.height * .42)}, short,
    reveal: () => root().remove('dust-opening'), done: () => root().remove('dust-opening')}));
  // Whatever happens, the library is never left hidden.
  setTimeout(() => {root().remove('dust-opening'); if (veil && !Stage.busy()) veil.style.opacity = '0';}, 7000);
}

/** A copy on its way to the Kobo: from its cover (or the capsule) to the device in the sidebar. */
export async function toKobo(book: Book | undefined): Promise<M.Travel | null> {
  if (!Stage.enabled()) return null;
  const device = Stage.onScreen(document.querySelector('[data-tour="kobo"] .device .ico'));
  if (!device) return null;
  const rect = (book && Stage.coverOf(book.hash)) ?? Stage.onScreen(document.querySelector('.capsule .kobo-ico'));
  if (!rect) return null;
  const picture = book ? await Stage.picturesOf([book.hash], 300).then(p => p.get(book.hash) ?? null) : null;
  const moment = M.travel({source: {rect, picture, tint: book?.tint}, to: centre(device), onArrive: () => pulse('[data-tour="kobo"] .device')});
  Stage.play(moment);
  return moment;
}

function pulse(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.remove('dust-arrive'); void (el as HTMLElement).offsetWidth; el.classList.add('dust-arrive');
  setTimeout(() => el.classList.remove('dust-arrive'), 900);
}

/** A book opens: the sheet's cover becomes the lines of the page; the reader comes into focus underneath. */
export async function openBook(book: Book) {
  if (!Stage.enabled()) return;
  const rect = Stage.onScreen(document.querySelector('.sheet .cover'));
  if (!rect) return;
  const picture = (await Stage.picturesOf([book.hash], 120)).get(book.hash) ?? null;
  const dark = document.documentElement.classList.contains('md-dark');
  Stage.play(M.openBook({source: {rect, picture, tint: book.tint}, page: {x: 0, y: 52, width: innerWidth, height: innerHeight - 100},
    pageInk: dark ? [220, 214, 204] : [40, 36, 30]}));
}

/** Books just finished: each cover condenses into a star that rises to the reading sky. */
export async function finished(list: Book[]) {
  if (!Stage.enabled() || !list.length) return;
  const sky = Stage.onScreen(document.querySelector('[data-sky] .ico'));
  if (!sky) return;
  // A cover out of sight (the usual case after a synchronisation) is born as dust in the middle of the library.
  const content = Stage.onScreen(document.querySelector('.content')) ?? new DOMRect(0, 0, innerWidth, innerHeight);
  const middle = (k: number) => new DOMRect(content.x + content.width / 2 - 55 + (k - (Math.min(3, list.length) - 1) / 2) * 140, content.y + content.height / 2 - 82, 110, 165);
  const shown = list.slice(0, 3).map((b, k) => ({b, rect: Stage.coverOf(b.hash) ?? middle(k)}));
  const pictures = await Stage.picturesOf(shown.map(x => x.b.hash));
  shown.forEach(({b, rect}, k) => setTimeout(() => Stage.play(M.finished({source: {rect, picture: pictures.get(b.hash) ?? null, tint: b.tint}, to: centre(sky),
    onArrive: () => pulse('[data-sky]')})), k * 450));
}

/** What leaves the Kobo, after the owner's click: the rows scatter. */
export function disperse(rects: DOMRect[]) {
  if (!Stage.enabled() || !rects.length) return;
  Stage.play(M.disperse({rects, colour: M.ink()}));
}

/** A share sent: a copy of each book leaves the window as dust. */
export async function shared(thumbs: {hash: string; rect: DOMRect}[], to: DOMRect, books: Map<string, Book>) {
  if (!Stage.enabled()) return;
  const pictures = await Stage.picturesOf(thumbs.map(t => t.hash), 300);
  thumbs.slice(0, 3).forEach((t, k) => setTimeout(() => Stage.play(M.travel({source: {rect: t.rect, picture: pictures.get(t.hash) ?? null, tint: books.get(t.hash)?.tint},
    to: centre(to), warm: false})), k * 120));
}

/** Vera dreams: returns how to wake it. */
export async function dream(books: Map<string, Book>, passages: {text: string; title: string; authors: string}[]): Promise<() => void> {
  if (!Stage.enabled()) return () => {};
  const font = '400 40px "Instrument Serif", Georgia, serif';
  await document.fonts.load(font).catch(() => []);
  const sources = await visibleCovers(books, 30);
  const moment = M.dream({sources, passages, font});
  const playing = Stage.play(moment);
  root().add('dust-dreaming');
  return () => {
    root().remove('dust-dreaming');
    moment.wake();
    setTimeout(() => playing.stop(), 1000);
  };
}
