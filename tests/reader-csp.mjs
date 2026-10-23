// A book's own scripts never run in Vera's reader (docs/DECISIONS.md, section L). This opens a trapped EPUB
// (tests/fixtures/piege.epub: an inline script, a script file, a data: script, an onerror attribute) with
// foliate-js, under the window's Content-Security-Policy taken from src-tauri/tauri.conf.json, then once without it
// as a control. Needs a Chromium: `npm i --no-save playwright-core`, and CHROMIUM=<path> if Playwright's is absent.
// Run by hand after any change of the policy or of foliate-js: node tests/reader-csp.mjs
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {build} from 'vite';

const {chromium} = await import('playwright-core').catch(() => {
  console.error('playwright-core manque : npm i --no-save playwright-core');
  process.exit(2);
});
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-csp-'));
await build({root: 'tests/reader-csp', logLevel: 'warn', build: {outDir: out, emptyOutDir: true}});
fs.copyFileSync('tests/fixtures/piege.epub', path.join(out, 'piege.epub'));
const csp = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
const types = {'.html': 'text/html', '.js': 'text/javascript', '.epub': 'application/epub+zip'};

function serve(policy) {
  const server = http.createServer((req, res) => {
    const file = path.join(out, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(out) || !fs.existsSync(file)) {res.writeHead(404); res.end(); return;}
    res.writeHead(200, {'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', ...(policy ? {'Content-Security-Policy': policy} : {})});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
async function run(policy) {
  const server = await serve(policy);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__opened, null, {timeout: 20000});
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => window.__pwned ?? null);
  await page.close();
  server.close();
  return result;
}
const guarded = await run(csp);
const control = await run(null);
await browser.close();
fs.rmSync(out, {recursive: true, force: true});
if (guarded !== null) {console.error(`ÉCHEC : un script du livre s’est exécuté sous la politique de Vera (${guarded}).`); process.exit(1);}
if (control === null) {console.error('Témoin sans effet : le livre piégé ne déclenche plus rien, le test ne prouve rien.'); process.exit(1);}
console.log(`PASS : aucun script du livre ne s’exécute sous la politique de Vera (sans elle, le piège « ${control} » se déclenche).`);
