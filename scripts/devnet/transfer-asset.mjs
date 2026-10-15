#!/usr/bin/env node
/**
 * Moves a citizen NFT from one wallet to another on the cluster, the way a
 * sale would, so the owner checks of the chat and mission servers can be tried
 * against a real transfer (SPEC section 15.5).
 *
 * Without --send it only asks the cluster to simulate the transfer and prints
 * the result; nothing is signed or spent. With --send the current owner's key
 * signs and the transfer happens for real.
 *
 * Usage (from the repository root):
 *   node scripts/devnet/transfer-asset.mjs <asset address> <new owner address>
 *                                          --keypair <key file of the CURRENT owner>
 *                                          [--send] [--config config/devnet.json] [--rpc <url>]
 *
 * The key file is the JSON array `solana-keygen` writes. The owner needs a
 * little SOL for the fee. After --send, the old wallet is refused by the chat
 * server on its next request and the new wallet is let in.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeRpc, encodeBase58 } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const metaplexEntry = resolve(repoRoot, 'packages/metaplex-client/dist/index.js');
if (!existsSync(metaplexEntry)) {
  console.error('packages/metaplex-client is not built. Run `pnpm install` (or `pnpm build:packages`) first.');
  process.exit(1);
}
const { buildTransferAsset, createMetaplexContext, readAssetOwnership, signerFromSecretKey, useSigner } = await import(
  pathToFileURL(metaplexEntry).href
);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const flagged = new Set();
process.argv.forEach((arg, index) => {
  if (arg.startsWith('--')) {
    flagged.add(index);
    if (arg !== '--send') flagged.add(index + 1);
  }
});
const [asset, newOwner] = process.argv.slice(2).filter((_, index) => !flagged.has(index + 2));
const send = process.argv.includes('--send');
const keypairArg = option('keypair');

if (!asset || !newOwner || !keypairArg) {
  console.error('Usage: node scripts/devnet/transfer-asset.mjs <asset> <new owner> --keypair <current owner key file> [--send]');
  process.exit(1);
}
const keypairPath = resolve(process.cwd(), keypairArg);
if (!existsSync(keypairPath)) {
  console.error(`Key file not found: ${keypairPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(resolve(repoRoot, option('config', 'config/devnet.json')), 'utf8'));
const rpcUrl = option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl);

const umi = createMetaplexContext(rpcUrl);
const signer = signerFromSecretKey(umi, Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
useSigner(umi, signer);

console.log(`RPC        ${describeRpc(rpcUrl)}`);
const before = await readAssetOwnership(umi, asset);
if (!before) {
  console.error(`No Core asset at ${asset} on this cluster.`);
  process.exit(1);
}
console.log(`Asset      ${asset}`);
console.log(`Owner now  ${before.owner}`);
console.log(`Collection ${before.collection ?? 'none'}`);
console.log(`New owner  ${newOwner}`);

if (before.owner !== signer.publicKey) {
  console.error(`\nThe key file is ${signer.publicKey}, which is not the owner. Only the owner can transfer.`);
  process.exit(1);
}
if (before.collection && before.collection !== config.coreCollection) {
  console.error(`\nThis asset is in collection ${before.collection}, not the ${config.coreCollection} named in the manifest. Refusing.`);
  process.exit(1);
}

const builder = buildTransferAsset(umi, { asset, collection: before.collection, newOwner });

if (!send) {
  const transaction = await builder.buildWithLatestBlockhash(umi);
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [
        Buffer.from(umi.transactions.serialize(transaction)).toString('base64'),
        { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' },
      ],
    }),
  });
  const body = await response.json();
  if (body.error) {
    console.error(`\nThe RPC refused the simulation: ${body.error.message}`);
    process.exit(1);
  }
  const result = body.result.value;
  for (const line of result.logs ?? []) console.log(`  ${line}`);
  if (result.err) {
    console.error(`\nThe cluster would refuse this transfer: ${JSON.stringify(result.err)}`);
    process.exit(1);
  }
  console.log('\nThe cluster would accept this transfer. Nothing was sent. Add --send to do it for real.');
  process.exit(0);
}

const { signature } = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
const after = await readAssetOwnership(umi, asset);
console.log(`\nSent. Signature ${encodeBase58(signature)}`);
console.log(`Owner now  ${after?.owner ?? 'unknown'}`);
if (after?.owner !== newOwner) {
  console.error('The cluster does not show the new owner yet. Check the transaction in the explorer.');
  process.exit(1);
}
process.exit(0);
