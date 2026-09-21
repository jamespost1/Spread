#!/usr/bin/env node
// Fails the build if dist/ is not a loadable Chrome extension.
//
// Catches the class of mistake that only shows up when you drag the folder
// into chrome://extensions: a manifest pointing at a file the build forgot to
// emit, or an HTML page referencing a stylesheet that was never copied.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

const manifestPath = path.join(DIST, 'manifest.json');
check(existsSync(manifestPath), 'manifest.json is missing from dist/');

if (problems.length === 0) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  check(manifest.manifest_version === 3, 'manifest_version must be 3');
  check(Boolean(manifest.name), 'manifest is missing a name');
  check(/^\d+\.\d+\.\d+$/.test(manifest.version || ''), 'version must be x.y.z');
  check(!/\bMVP\b|\bTODO\b|\btest\b/i.test(manifest.name), 'name still contains a placeholder word');
  check(Boolean(manifest.action?.default_popup), 'no toolbar popup declared');

  // Every path the manifest names must actually exist.
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ].filter(Boolean);

  for (const ref of referenced) {
    check(existsSync(path.join(DIST, ref)), `manifest references missing file: ${ref}`);
  }

  // Every local asset an HTML page pulls in must exist too.
  for (const pageName of ['popup.html', 'options.html']) {
    const pagePath = path.join(DIST, pageName);
    if (!existsSync(pagePath)) continue;

    const html = readFileSync(pagePath, 'utf8');
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const asset = match[1];
      if (asset.startsWith('http') || asset.startsWith('#')) continue;
      check(existsSync(path.join(DIST, asset)), `${pageName} references missing asset: ${asset}`);
    }
  }

  // Permissions the code does not use get an extension rejected at review.
  const bundles = ['content.js', 'background.js', 'popup.js', 'options.js']
    .map((f) => path.join(DIST, f))
    .filter(existsSync)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  const permissionUsage = {
    storage: /chrome\.storage/,
    activeTab: /chrome\.tabs/,
    scripting: /chrome\.scripting/,
    tabs: /chrome\.tabs/,
  };

  for (const permission of manifest.permissions || []) {
    const pattern = permissionUsage[permission];
    if (pattern) {
      check(pattern.test(bundles), `permission "${permission}" is declared but never used`);
    }
  }
}

if (problems.length > 0) {
  console.error('\n  Build verification failed:\n');
  for (const problem of problems) console.error(`    ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('  ✓ dist/ is a loadable Chrome extension');
