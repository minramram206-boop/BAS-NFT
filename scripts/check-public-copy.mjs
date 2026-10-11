#!/usr/bin/env node
/** Guard the public English copy and citizen rosters against protocol names and Indonesian labels. */

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

// Citizen names are public copy too. Honorifics and words used as names in
// Indonesian (Pak, Bu, Mbah, Kapten, ...) keep the roster tied to one country.
const IndonesianNameParts =
  /\b(?:pak|bu|ibu|bapak|mas|mbak|mbah|kang|neng|dik|adik|bos|kapten|udara|tani|pejabat|kupluk|koper|petualang)\b/i;
const rosters = ['content/en/citizens.json', 'content/en/citizens.archive.json'];
let names = 0;
for (const roster of rosters) {
  const citizens = JSON.parse(await readFile(join(repoRoot, roster), 'utf8'));
  for (const citizen of citizens) {
    names += 1;
    assert.doesNotMatch(citizen.name, IndonesianNameParts, `${roster}: "${citizen.name}" must be an English name`);
    assert.doesNotMatch(citizen.lore, IndonesianUiTerms, `${roster}: lore of "${citizen.name}" must be English`);
  }
}

console.log(`public copy passed (${copy.length} strings and ${names} citizen names checked)`);
