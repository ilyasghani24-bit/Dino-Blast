// Production build: bundles src/ + three.js into dist/game.js and copies the
// static files, so dist/ can be uploaded to any static host as-is.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  outfile: `${out}/game.js`,
  logLevel: 'info',
});

let html = await readFile('index.html', 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace('src="src/main.js"', 'src="game.js"');
await writeFile(`${out}/index.html`, html);
await cp('style.css', `${out}/style.css`);
await cp('assets', `${out}/assets`, { recursive: true });
console.log('Built to dist/');
