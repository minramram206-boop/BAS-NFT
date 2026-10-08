#!/usr/bin/env node
/** Keep the OFL notices shipped with the self-hosted web fonts intact. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = [
  ['pixelify-sans', '@fontsource/pixelify-sans'],
  ['silkscreen', '@fontsource/silkscreen'],
];

for (const [font, packageName] of fonts) {
  const bundled = await readFile(join(repoRoot, 'apps/web/public/licenses', `${font}-OFL.txt`), 'utf8');
  const upstream = await readFile(join(repoRoot, 'apps/web/node_modules', packageName, 'LICENSE'), 'utf8');
  assert.equal(bundled, upstream, `${font} copyright and OFL text must match its pinned source package`);
  assert.match(bundled, /SIL OPEN FONT LICENSE Version 1\.1/);
}

console.log(`font license notices passed (${fonts.length} fonts checked)`);
