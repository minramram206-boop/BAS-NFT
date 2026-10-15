#!/usr/bin/env node
/**
 * Writes the NFT metadata files the program expects under the approved template prefix.
 *
 * `register_citizen` accepts an asset only when its URI is `<prefix><serial>-<role>.json` (D-0013,
 * D-0022), so each citizen of the roster and the archive gets one file named that way, in the
 * Metaplex token metadata layout. Role and starting stats come from `content/en/roles.json`, the
 * same table the program uses.
 *
 * Devnet serves them from the web app itself (D-0024 item 6): the files land in
 * `apps/web/public/templates/<templateId>/`. For mainnet, pass the origin the files will be
 * uploaded to and an output folder to upload from.
 *
 * Usage: node scripts/gen-metadata.mjs [--origin https://host] [--out folder]
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEVNET_ORIGIN = 'https://bas-district-devnet.vercel.app';
const SYMBOL = 'BAS';

const readJson = async (path) => JSON.parse(await readFile(join(repoRoot, path), 'utf8'));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const { approvedTemplateId } = await readJson('config/devnet.json');
const origin = option('origin', DEVNET_ORIGIN).replace(/\/+$/, '');
const out = resolve(repoRoot, option('out', `apps/web/public/templates/${approvedTemplateId}`));

const roles = new Map((await readJson('content/en/roles.json')).map((role) => [role.key, role]));
const citizens = [...(await readJson('content/en/citizens.json')), ...(await readJson('content/en/citizens.archive.json'))];

/** `001-artisan.json`: the serial first, the role code name last, as the program reads it. */
const fileNameOf = (citizen) => `${String(citizen.id).padStart(3, '0')}-${citizen.roleKey}.json`;

function metadataOf(citizen) {
  const role = roles.get(citizen.roleKey);
  if (!role) throw new Error(`citizen ${citizen.id} has an unknown role "${citizen.roleKey}"`);
  const image = `${origin}${citizen.image}`;
  return {
    name: `${citizen.name} ${citizen.code}`,
    symbol: SYMBOL,
    description: citizen.lore,
    image,
    external_url: `${origin}/citizen/${citizen.id}`,
    attributes: [
      { trait_type: 'Role', value: role.label },
      { trait_type: 'Serial', value: citizen.code },
      { trait_type: 'Insight', value: role.initialStats.intelligence },
      { trait_type: 'Bond', value: role.initialStats.alignment },
      { trait_type: 'Craft', value: role.initialStats.compute },
    ],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

await mkdir(out, { recursive: true });
// Drop files of citizens that no longer exist, so the folder always mirrors the content.
const wanted = new Set(citizens.map(fileNameOf));
for (const name of await readdir(out)) {
  if (name.endsWith('.json') && !wanted.has(name)) await rm(join(out, name));
}
for (const citizen of citizens) {
  await writeFile(join(out, fileNameOf(citizen)), `${JSON.stringify(metadataOf(citizen), null, 2)}\n`);
}
console.log(`wrote ${citizens.length} metadata files to ${out}`);
