// Interface checks run by GitHub before the build (npm test).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {accents, readerThemes, themes} from '../src/theme.ts';
import {list, matches, plural, size, sorted, surname, when} from '../src/format.ts';

// Every command the interface calls is registered by the application.
const api = fs.readFileSync('src/api.ts', 'utf8');
const used = JSON.parse(api.match(/export const COMMANDS = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
const main = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const registered = [...main.matchAll(/(?:commands|share|update)::(\w+)/g)].map(m => m[1]);
for (const name of used) assert(registered.includes(name), `commande « ${name} » absente de src-tauri`);
for (const call of api.matchAll(/call<[^>]*>\('(\w+)'/g)) assert(used.includes(call[1]), `commande « ${call[1]} » absente de COMMANDS`);

// Text stays readable in both themes, light and dark (WCAG AA, 4.5:1).
function luminance(hex) {
  return hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
}
const ratio = (a, b) => {const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);};
// Every theme, light and dark, with its own accent and each macOS accent.
for (const [id, theme] of Object.entries(themes)) {
  for (const [mode, p] of Object.entries(theme.surfaces)) {
    const ground = p.bg;
    for (const [fg, bg] of [['ink', 'bg'], ['muted', 'bg'], ['warn', 'bg'], ['ink', 'card'], ['muted', 'card']]) {
      if (!p[bg].startsWith('#')) continue;
      assert(ratio(p[fg], p[bg]) >= 4.5, `${id} ${mode} : ${fg} ${p[fg]} sur ${bg} ${p[bg]} = ${ratio(p[fg], p[bg]).toFixed(2)}`);
    }
    for (const [accent, t] of [['maison', theme.accent[mode]], ...Object.entries(accents).map(([a, tones]) => [a, tones[mode]])]) {
      assert(ratio(t.onFill, t.fill) >= 4.5, `${id} ${accent} ${mode} : texte ${t.onFill} sur ${t.fill} = ${ratio(t.onFill, t.fill).toFixed(2)}`);
      assert(ratio(t.text, ground) >= 4.5, `${id} ${accent} ${mode} : accent ${t.text} sur ${ground} = ${ratio(t.text, ground).toFixed(2)}`);
    }
  }
}
// The reader's backgrounds too.
for (const [name, t] of Object.entries(readerThemes)) {
  for (const fg of ['ink', 'muted']) assert(ratio(t[fg], t.bg) >= 4.5, `lecture ${name} : ${fg} ${t[fg]} sur ${t.bg} = ${ratio(t[fg], t.bg).toFixed(2)}`);
}

// A book's own scripts never run: the window allows no inline script, no eval, no script from blob: or data:
// (the pages of an EPUB are blob: documents that inherit this policy; checked in a browser against a trapped EPUB).
const csp = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
const scriptSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src')) ?? '';
assert(scriptSrc && !/'unsafe-inline'|'unsafe-eval'|blob:|data:|\*|https?:/.test(scriptSrc), `script-src trop permissif : ${scriptSrc}`);
assert(/object-src 'none'/.test(csp), 'object-src doit être none');

// French wording.
assert.equal(plural(1, 'livre', 'livres'), '1 livre');
assert.equal(plural(3, 'livre', 'livres'), '3 livres');
assert.equal(size(2.6 * 1024 * 1024).replace(/\s/g, ' '), '2,6 Mo');
assert.equal(size(3.1 * 1024 ** 3).replace(/\s/g, ' '), '3,1 Go');
const noon = new Date(2026, 9, 22, 14, 12).getTime();
assert.equal(when(noon / 1000, noon), 'aujourd’hui à 14 h 12');
assert.equal(when(noon / 1000 - 86_400, noon), 'hier à 14 h 12');
assert.equal(list(['A', 'B', 'C', 'D', 'E']), 'A, B, C et 2 autres');
assert(matches('emile zola', 'Germinal', 'Émile Zola'));
assert(!matches('hugo', 'Germinal', 'Émile Zola'));
// Sorting as in a bookshop: titles without their article, authors by surname.
assert.equal(surname('Victor Hugo'), 'Hugo');
assert.equal(surname('Hugo, Victor'), 'Hugo');
const shelf = [{title: 'Les Misérables', authors: 'Victor Hugo', addedAt: 1}, {title: 'Germinal', authors: 'Émile Zola', addedAt: 3}, {title: 'Dracula', authors: 'Bram Stoker', addedAt: 2}];
assert.deepEqual(sorted(shelf, 'title').map(b => b.title), ['Dracula', 'Germinal', 'Les Misérables']);
assert.deepEqual(sorted(shelf, 'author').map(b => b.authors), ['Victor Hugo', 'Bram Stoker', 'Émile Zola']);
assert.deepEqual(sorted(shelf, 'recent').map(b => b.addedAt), [3, 2, 1]);

// The browser preview never ships: only api.ts may load it, behind import.meta.env.DEV.
assert(/if \(import\.meta\.env\.DEV\) return mock \?\?= import\('\.\/dev\/mock'\)/.test(api));

console.log(`PASS : ${used.length} commandes reliées, contrastes AA des 5 thèmes avec leurs 9 couleurs d’accent en clair et sombre, français, recherche sans accents, tri, lecture (contrastes, aucun script de livre).`);
