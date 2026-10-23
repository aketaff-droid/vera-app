import {defineConfig, type Plugin} from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// pdf.js reads its fonts, CMaps, colour profiles and decoders at run time: they are served from /pdfjs/, copied
// from the package at build time and read from it in development. Nothing is fetched from the network.
const PDFJS = path.resolve('node_modules/pdfjs-dist');
const FOLDERS = ['cmaps', 'standard_fonts', 'iccs', 'wasm'];

function pdfjsAssets(): Plugin {
  return {
    name: 'vera-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? '').split('?')[0]!).replace(/^\/+/, '');
        const file = path.resolve(PDFJS, relative);
        if (!FOLDERS.some(f => file.startsWith(path.join(PDFJS, f) + path.sep)) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      for (const folder of FOLDERS) fs.cpSync(path.join(PDFJS, folder), path.join(options.dir ?? 'dist', 'pdfjs', folder), {recursive: true});
    },
  };
}

export default defineConfig({plugins: [pdfjsAssets()]});
