#!/usr/bin/env node
/** Guard the one public English copy catalog against protocol names and Indonesian labels. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(repoRoot, 'apps/web/src/messages/en.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

function collectStringValues(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, output));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStringValues(item, output));
  }
  return output;
}

const copy = collectStringValues(catalog);
const fullCopy = copy.join('\n').toLowerCase();
const internalStatNames = /\b(?:intelligence|alignment|compute|composure|int|aln|cmp)\b/i;
const IndonesianUiTerms = /\b(?:warga|terdaftar|belum|latih|tutup|kembali|halaman|cari|klik|pilih|aksi|distrik|skor|interaksi)\b/i;

assert.ok(copy.length >= 50, 'the English catalog should contain the app copy');
assert.doesNotMatch(fullCopy, internalStatNames, 'public copy must use Insight, Bond and Craft');
assert.doesNotMatch(fullCopy, IndonesianUiTerms, 'public interface copy must remain English');
assert.deepEqual(
  Object.fromEntries(Object.entries(catalog.stats).map(([key, stat]) => [key, stat.label])),
  { intelligence: 'Insight', alignment: 'Bond', compute: 'Craft' },
  'internal stat keys must map to the approved public English labels',
);

console.log(`public copy passed (${copy.length} strings checked)`);
