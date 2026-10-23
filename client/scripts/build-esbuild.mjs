// Fallback production build using esbuild directly. `npm run build` (Vite) is the real build;
// this script produces the same dist/ layout so the server can serve it, and is handy for CI
// environments or sandboxes where Vite cannot be installed.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let esbuild;
for (const spec of ['esbuild', '/opt/npm-tools/node_modules/esbuild/lib/main.js']) {
  try { esbuild = require(spec); break; } catch { /* try next */ }
}
if (!esbuild) { console.error('esbuild is not installed.'); process.exit(1); }

const nodePaths = (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean);
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const result = await esbuild.build({
  entryPoints: { app: path.join(root, 'src/main.jsx') },
  bundle: true, minify: true, format: 'esm', target: ['es2020'], jsx: 'automatic', sourcemap: false,
  outdir: path.join(out, 'assets'), entryNames: '[name]-[hash]', nodePaths, logLevel: 'warning', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl' },
});

const files = Object.keys(result.metafile.outputs).map((f) => path.basename(f));
const js = files.find((f) => f.endsWith('.js')); const css = files.find((f) => f.endsWith('.css'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="/src/main.jsx"></script>', `<script type="module" src="/assets/${js}"></script>`)
  .replace('</head>', `    <link rel="stylesheet" href="/assets/${css}" />\n  </head>`);
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of fs.readdirSync(path.join(root, 'public'))) fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
const kb = (f) => `${(fs.statSync(path.join(out, 'assets', f)).size / 1024).toFixed(1)} kB`;
console.log(`built dist/: ${js} (${kb(js)}), ${css} (${kb(css)})`);
