#!/usr/bin/env node
/**
 * Lists the citizen NFTs a wallet owns on the cluster, with the asset address
 * that `transfer-asset.mjs` and the explorer ask for. It only reads: no key is
 * needed and nothing is signed.
 *
 * Usage (from the repository root):
 *   node scripts/devnet/list-citizens.mjs <wallet address> [--config config/devnet.json] [--rpc <url>]
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MPL_CORE_PROGRAM, PublicKey, createRpc, describeRpc } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const flagged = new Set();
process.argv.forEach((arg, index) => {
  if (arg.startsWith('--')) {
    flagged.add(index);
    flagged.add(index + 1);
  }
});
const [wallet] = process.argv.slice(2).filter((_, index) => !flagged.has(index + 2));
if (!wallet) {
  console.error('Usage: node scripts/devnet/list-citizens.mjs <wallet address> [--rpc <url>]');
  process.exit(1);
}
try {
  new PublicKey(wallet);
} catch {
  console.error(`"${wallet}" is not a wallet address.`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(resolve(repoRoot, option('config', 'config/devnet.json')), 'utf8'));
const rpcUrl = option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl);

/** Core asset: key (1), owner (32), update authority kind (1) and collection (32), then name and uri as length-prefixed strings. */
function readText(data, offset) {
  const length = data.readUInt32LE(offset);
  return { text: data.subarray(offset + 4, offset + 4 + length).toString('utf8'), next: offset + 4 + length };
}

const rpc = createRpc(rpcUrl);
const found = await rpc.call('getProgramAccounts', [
  MPL_CORE_PROGRAM.toString(),
  {
    encoding: 'base64',
    commitment: 'confirmed',
    filters: [
      { memcmp: { offset: 1, bytes: wallet } },
      { memcmp: { offset: 34, bytes: config.coreCollection } },
    ],
  },
]);

console.log(`RPC     ${describeRpc(rpcUrl)}`);
console.log(`Wallet  ${wallet}`);
if (found.length === 0) {
  console.log('No citizen of this collection is owned by this wallet.');
  process.exit(0);
}
console.log(`Owns ${found.length} citizen${found.length === 1 ? '' : 's'}:\n`);
for (const entry of found) {
  const data = Buffer.from(entry.account.data[0], 'base64');
  const name = readText(data, 66);
  const uri = readText(data, name.next);
  console.log(`  ${name.text}`);
  console.log(`    asset  ${entry.pubkey}`);
  console.log(`    uri    ${uri.text}`);
}
