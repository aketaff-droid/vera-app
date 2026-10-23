import {coverSrc, type Book} from '../api';
import {authorsOf, compareNames, plural, surname} from '../format';

export interface Author {name: string; books: Book[]}

/** Every author of the library, with their books; « Victor Hugo » and « Hugo, Victor » are one author. */
export function authorsIn(books: Book[]): Author[] {
  const byKey = new Map<string, Author>();
  for (const book of books) {
    for (const name of authorsOf(book.authors)) {
      const display = name.includes(',') ? `${name.split(',').slice(1).join(',').trim()} ${name.split(',')[0]!.trim()}`.trim() : name;
      const key = display.toLowerCase();
      const author = byKey.get(key) ?? {name: display, books: []};
      author.books.push(book);
      byKey.set(key, author);
    }
  }
  return [...byKey.values()].sort((a, b) => compareNames(surname(a.name), surname(b.name)) || compareNames(a.name, b.name));
}

/** Initial of the surname, without its accent: É is filed under E. */
const initial = (name: string) => surname(name).normalize('NFD').charAt(0).toUpperCase();

export function AuthorList({authors, go}: {authors: Author[]; go: (name: string) => void}) {
  if (!authors.length) return <p className="note" style={{fontSize: 15}}>Aucun auteur : les livres de ton dossier n’indiquent pas le leur. Tu peux l’ajouter dans leur fiche.</p>;
  let last = '';
  return <div className="authors">{authors.flatMap(author => {
    const letter = /[A-Z]/.test(initial(author.name)) ? initial(author.name) : '#';
    const header = letter !== last ? [<h2 key={`l-${letter}`} className="letter">{letter}</h2>] : [];
    last = letter;
    const covers = author.books.slice(0, 3);
    return [...header, <button key={author.name} className="author-row" onClick={() => go(author.name)} aria-label={`${author.name}, ${plural(author.books.length, 'livre', 'livres')}`}>
      <span className="pile" aria-hidden="true">{covers.map(b => {
        const src = coverSrc(b.thumb ?? b.cover);
        return src ? <img key={b.hash} src={src} alt="" loading="lazy"/> : <span key={b.hash} className="blank"/>;
      })}</span>
      <span style={{display: 'flex', flexDirection: 'column', minWidth: 0}}>
        <span className="name">{author.name}</span>
        <span className="meta">{plural(author.books.length, 'livre', 'livres')}</span>
      </span>
    </button>];
  })}</div>;
}
