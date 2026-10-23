// French wording shared by every screen: sizes, plurals, relative dates, accent-insensitive search.

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function size(bytes: number): string {
  const mo = bytes / (1024 * 1024);
  if (mo >= 1024) return `${(mo / 1024).toLocaleString('fr-FR', {maximumFractionDigits: 1})} Go`;
  return `${mo.toLocaleString('fr-FR', {maximumFractionDigits: 1, minimumFractionDigits: mo < 10 ? 1 : 0})} Mo`;
}

/** « aujourd’hui à 14 h 12 », « hier à 9 h 05 », « lundi », « le 12 octobre ». */
export function when(seconds: number, now = Date.now()): string {
  const date = new Date(seconds * 1000);
  const today = new Date(now);
  const time = `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
  const day = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  const ago = day(today) - day(date);
  if (ago <= 0) return `aujourd’hui à ${time}`;
  if (ago === 1) return `hier à ${time}`;
  if (ago < 7) return date.toLocaleDateString('fr-FR', {weekday: 'long'});
  return `le ${date.toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'})}`;
}

export const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Every word of the query appears in the title or the authors, accents and case ignored. */
export function matches(query: string, ...fields: string[]): boolean {
  const haystack = fold(fields.join(' '));
  return fold(query).split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

/** « A, B et C », « A, B, C et 2 autres ». */
export function list(names: string[], shown = 3): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= shown) return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
  return `${names.slice(0, shown).join(', ')} et ${plural(names.length - shown, 'autre', 'autres')}`;
}

/** The authors of a book, as vera-core joins them (« A · B »). */
export const authorsOf = (authors: string) => authors.split(' · ').map(a => a.trim()).filter(Boolean);

/** The name an author is filed under: « Hugo » for « Victor Hugo » and for « Hugo, Victor ». */
export function surname(name: string): string {
  if (name.includes(',')) return name.split(',')[0]!.trim();
  return name.trim().split(/\s+/).pop() ?? name;
}

export type Sort = 'recent' | 'title' | 'author';
const collator = new Intl.Collator('fr', {sensitivity: 'base', numeric: true, ignorePunctuation: true});
/** Titles compared without their article: « Les Misérables » is filed under M, as in a bookshop. */
const filed = (title: string) => title.replace(/^(le|la|les|l’|l'|un|une|des|the|a|an)\s*/i, '');
const firstSurname = (authors: string) => surname(authorsOf(authors)[0] ?? '');

export function sorted<T extends {title: string; authors: string; addedAt: number}>(books: T[], sort: Sort): T[] {
  const copy = [...books];
  if (sort === 'title') return copy.sort((a, b) => collator.compare(filed(a.title), filed(b.title)));
  if (sort === 'author') return copy.sort((a, b) => collator.compare(firstSurname(a.authors), firstSurname(b.authors)) || collator.compare(filed(a.title), filed(b.title)));
  return copy.sort((a, b) => b.addedAt - a.addedAt);
}

export const compareNames = (a: string, b: string) => collator.compare(a, b);
