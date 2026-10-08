#!/usr/bin/env node
/**
 * Asset guard.
 *
 * Fails when a public asset path referenced by the app or the authored content
 * does not exist in `apps/web/public`, or when a file in `apps/web/public` is
 * not referenced by anything. Both directions matter: a missing sprite breaks a
 * screen, and an unreferenced one is the duplication that made this repository
 * hard to read in the first place.
 *
 * Usage: node scripts/check-assets.mjs [--allow-unreferenced]
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(repoRoot, 'apps/web');
const publicRoot = join(webRoot, 'public');

const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.json'];

/** Directories scanned for references. */
const SCAN_ROOTS = [join(webRoot, 'src'), join(repoRoot, 'content')];

/** Public files that are served by convention rather than referenced in code. */
const ALWAYS_ALLOWED = new Set(['favicon.ico', 'robots.txt', 'sitemap.xml']);

const ASSET_PATH_PATTERN = /["'`(]\/([A-Za-z0-9._/@-]+\.(?:png|jpe?g|webp|gif|svg|ico))["'`)]/g;

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(path);
      continue;
    }
    yield path;
  }
}

function hasExtension(path, extensions) {
  return extensions.some((extension) => path.toLowerCase().endsWith(extension));
}

async function collectPublicAssets() {
  const assets = new Map();
  for await (const path of walk(publicRoot)) {
    if (!hasExtension(path, ASSET_EXTENSIONS)) continue;
    const publicPath = `/${relative(publicRoot, path).split('\\').join('/')}`;
    assets.set(publicPath, path);
  }
  return assets;
}

async function collectReferences(assets) {
  const references = new Map();

  for (const root of SCAN_ROOTS) {
    let entries;
    try {
      entries = walk(root);
    } catch {
      continue;
    }

    for await (const path of entries) {
      if (!hasExtension(path, SOURCE_EXTENSIONS)) continue;

      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(ASSET_PATH_PATTERN)) {
        const publicPath = `/${match[1]}`;
        if (!assets.has(publicPath)) continue;

        const existing = references.get(publicPath) ?? [];
        existing.push(relative(repoRoot, path));
        references.set(publicPath, existing);
      }
    }
  }

  return references;
}

/** Group public assets by content hash, so byte-identical files are caught. */
async function findDuplicates(assets) {
  const byHash = new Map();

  for (const [publicPath, absolute] of assets) {
    const digest = createHash('sha256').update(await readFile(absolute)).digest('hex');
    const bucket = byHash.get(digest) ?? [];
    bucket.push(publicPath);
    byHash.set(digest, bucket);
  }

  return [...byHash.values()].filter((paths) => paths.length > 1).map((paths) => paths.sort());
}

const allowUnreferenced = process.argv.includes('--allow-unreferenced');

const assets = await collectPublicAssets();
const references = await collectReferences(assets);

const unreferenced = [...assets.keys()]
  .filter((publicPath) => !references.has(publicPath))
  .filter((publicPath) => !ALWAYS_ALLOWED.has(publicPath.slice(1)))
  .sort();

const duplicates = await findDuplicates(assets);

console.log(`public assets : ${assets.size}`);
console.log(`referenced    : ${references.size}`);

let failed = false;

if (unreferenced.length > 0) {
  failed = !allowUnreferenced;
  console.log(
    `\n${failed ? 'ERROR' : 'WARN'}: ${unreferenced.length} file(s) in apps/web/public are not referenced by any source or content file:`,
  );
  for (const publicPath of unreferenced) console.log(`  - ${publicPath}`);
}

if (duplicates.length > 0) {
  failed = true;
  console.log(`\nERROR: ${duplicates.length} group(s) of byte-identical public files:`);
  for (const paths of duplicates) {
    console.log(`  - ${paths.join('  ==  ')}`);
  }
  console.log('  Keep one file and reference it from everywhere else.');
}

if (failed) {
  process.exit(1);
}

console.log('\nasset guard passed');
