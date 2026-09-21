// build.mjs — bundles the extension sources into dist/ with esbuild.
// Content scripts cannot be ES modules in MV3, so each entry point is bundled
// into a single classic script. The service worker is a real module.

import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const dev = watch || process.env.NODE_ENV === 'development';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

/** Static files copied verbatim into the bundle. */
async function copyStatic() {
  await cp('public', 'dist', { recursive: true });
  for (const name of ['popup', 'options']) {
    await cp(`src/${name}/${name}.html`, `dist/${name}.html`);
    await cp(`src/${name}/${name}.css`, `dist/${name}.css`);
  }
}

const shared = {
  bundle: true,
  target: ['chrome110'],
  logLevel: 'info',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  // console.* is stripped in production builds; the extension should be silent
  // in a user's browser console.
  drop: dev ? [] : ['console', 'debugger'],
};

const builds = [
  { entryPoints: ['src/content/index.js'], outfile: 'dist/content.js', format: 'iife' },
  { entryPoints: ['src/background/index.js'], outfile: 'dist/background.js', format: 'esm' },
  { entryPoints: ['src/popup/popup.js'], outfile: 'dist/popup.js', format: 'iife' },
  { entryPoints: ['src/options/options.js'], outfile: 'dist/options.js', format: 'iife' },
];

await copyStatic();

if (watch) {
  const contexts = await Promise.all(
    builds.map((b) => esbuild.context({ ...shared, ...b }))
  );
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching...');
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...shared, ...b })));
  console.log('built dist/');
}
