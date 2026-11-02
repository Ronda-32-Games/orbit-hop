// Build del cliente (dist/) y del servidor (dist-worker/) con esbuild.
//   node tools/build.mjs            → dist/ para GitHub Pages
//   node tools/build.mjs --serve    → servidor local en http://localhost:8032
//   node tools/build.mjs --worker   → dist-worker/worker.js
// API_URL=https://orbit-hop-api.<cuenta>.workers.dev node tools/build.mjs  → con Daily
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const api = process.env.API_URL ?? '';

if (args.has('--worker')) {
  await esbuild.build({
    entryPoints: ['src/server/worker.ts'], bundle: true, format: 'esm', target: 'es2022',
    outfile: 'dist-worker/worker.js', minify: true,
  });
  console.log('dist-worker/worker.js', statSync('dist-worker/worker.js').size, 'bytes');
} else {
  mkdirSync('dist', { recursive: true });
  copyFileSync('src/client/index.html', 'dist/index.html');
  const opts = {
    entryPoints: ['src/client/main.ts'], bundle: true, format: 'esm', target: 'es2020',
    outfile: 'dist/game.js', minify: true, sourcemap: false,
    define: { __API_URL__: JSON.stringify(api) },
  };
  if (args.has('--serve')) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    const { port } = await ctx.serve({ servedir: 'dist', port: 8032 });
    console.log(`http://localhost:${port}/  (?test, ?seed=32, ?round=5, ?selftest)`);
  } else {
    await esbuild.build(opts);
    const js = statSync('dist/game.js').size, html = statSync('dist/index.html').size;
    console.log(`dist/game.js ${js} bytes · dist/index.html ${html} bytes · total ${js + html} bytes`);
  }
}
