#!/usr/bin/env node
/**
 * Metadata guard.
 *
 * The program refuses an asset whose URI is not `<approved prefix><serial>-<role>.json`, and role
 * and stats are read from that name (D-0013, D-0022). This checks the files the web app serves for
 * devnet: one per citizen, named the way the program reads them, agreeing with the content, and
 * pointing at images that exist. Run `node scripts/gen-metadata.mjs` to rewrite them.
 *
 * Usage: node scripts/check-metadata.mjs
 */

import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { roleFromMetadataFile } from '../packages/chain-client/dist/index.js';
import { isValidTemplateUriPrefix } from '../packages/config/dist/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(join(repoRoot, path), 'utf8'));

const { approvedTemplateId } = await readJson('config/devnet.json');
const folder = join(repoRoot, `apps/web/public/templates/${approvedTemplateId}`);
const roles = new Map((await readJson('content/en/roles.json')).map((role) => [role.key, role]));
const citizens = [...(await readJson('content/en/citizens.json')), ...(await readJson('content/en/citizens.archive.json'))];

// The origin the devnet setup locks into the program must be the one the files are served from.
const setup = await readFile(join(repoRoot, 'scripts/devnet/setup.mjs'), 'utf8');
const prefix = /DEVNET_METADATA_PREFIX\s*=\s*'([^']+)'/.exec(setup)?.[1];
assert.ok(prefix, 'scripts/devnet/setup.mjs must define DEVNET_METADATA_PREFIX');
assert.ok(isValidTemplateUriPrefix(prefix, approvedTemplateId), `${prefix} is not a valid template URI prefix`);
const origin = new URL(prefix).origin;

const files = (await readdir(folder)).filter((name) => name.endsWith('.json')).sort();
const expected = citizens.map((citizen) => `${String(citizen.id).padStart(3, '0')}-${citizen.roleKey}.json`).sort();
assert.deepEqual(files, expected, 'there must be exactly one metadata file per citizen; run scripts/gen-metadata.mjs');

for (const citizen of citizens) {
  const name = `${String(citizen.id).padStart(3, '0')}-${citizen.roleKey}.json`;
  const role = roleFromMetadataFile(name);
  assert.equal(role?.key, citizen.roleKey, `${name}: the program would read role "${role?.key}"`);
  assert.ok((prefix + name).length <= 200, `${name}: URI is longer than the on-chain limit`);

  const metadata = JSON.parse(await readFile(join(folder, name), 'utf8'));
  const attribute = (type) => metadata.attributes.find((entry) => entry.trait_type === type)?.value;
  const { initialStats } = roles.get(citizen.roleKey);
  assert.equal(metadata.name, `${citizen.name} ${citizen.code}`, `${name}: name`);
  assert.equal(metadata.description, citizen.lore, `${name}: description`);
  assert.equal(attribute('Role'), roles.get(citizen.roleKey).label, `${name}: Role attribute`);
  assert.equal(attribute('Serial'), citizen.code, `${name}: Serial attribute`);
  assert.equal(attribute('Insight'), initialStats.intelligence, `${name}: Insight attribute`);
  assert.equal(attribute('Bond'), initialStats.alignment, `${name}: Bond attribute`);
  assert.equal(attribute('Craft'), initialStats.compute, `${name}: Craft attribute`);
  assert.equal(metadata.image, `${origin}${citizen.image}`, `${name}: image must live on the metadata origin`);
  assert.equal(metadata.properties.files[0].uri, metadata.image, `${name}: properties.files[0]`);
  await access(join(repoRoot, 'apps/web/public', citizen.image)); // throws when the art is missing
}

console.log(`metadata guard passed (${files.length} files, ${prefix})`);
