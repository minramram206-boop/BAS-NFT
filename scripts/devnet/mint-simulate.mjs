#!/usr/bin/env node
/**
 * Dry run of one public mint on the cluster (D-0061): asks the cluster to
 * simulate the transaction the mission server would hand to a wallet, without
 * signing or spending anything. Run it after scripts/devnet/mint-setup.mjs and
 * before the first real mint.
 *
 * It reports the sale state, whether the Candy Guard and `register_citizen`
 * accept the transaction, the compute units used, and the size in bytes. The
 * compute units are what MINT_COMPUTE_UNIT_LIMIT
 * (packages/metaplex-client/src/backend.ts) has to cover.
 *
 * Usage (from the repository root):
 *   node scripts/devnet/mint-simulate.mjs [--wallet <address>]
 *                                         [--keypair .keys/devnet-deployer.json]
 *                                         [--mint-signer-key .keys/devnet-mint-signer.json]
 *                                         [--config config/devnet.json] [--rpc <url>]
 *
 * Without --wallet the deployer's address is used. The wallet needs the price
 * plus a little rent in SOL, because the cluster really runs the payment.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeRpc } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const metaplexEntry = resolve(repoRoot, 'packages/metaplex-client/dist/index.js');
if (!existsSync(metaplexEntry)) {
  console.error('packages/metaplex-client is not built. Run `pnpm install` (or `pnpm build:packages`) first.');
  process.exit(1);
}
const { MINT_COMPUTE_UNIT_LIMIT, MINT_LIMIT_ID, createMintBackend, createMetaplexContext, signerFromSecretKey } = await import(
  pathToFileURL(metaplexEntry).href
);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const config = JSON.parse(readFileSync(resolve(repoRoot, option('config', 'config/devnet.json')), 'utf8'));
const rpcUrl = option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl);
const mintSignerPath = resolve(repoRoot, option('mint-signer-key', '.keys/devnet-mint-signer.json'));
const keypairPath = resolve(repoRoot, option('keypair', '.keys/devnet-deployer.json'));

const readKey = (path) => Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')));
if (!existsSync(mintSignerPath)) {
  console.error(`Mint signer key not found: ${mintSignerPath}. Run \`pnpm devnet:mint-setup\` first.`);
  process.exit(1);
}

let wallet = option('wallet');
if (!wallet) {
  if (!existsSync(keypairPath)) {
    console.error('Pass --wallet <address>, or keep the deployer key at .keys/devnet-deployer.json.');
    process.exit(1);
  }
  wallet = signerFromSecretKey(createMetaplexContext(rpcUrl), readKey(keypairPath)).publicKey;
}

const backend = createMintBackend({
  rpcUrl,
  programId: config.districtProgramId,
  approvedTemplateId: config.approvedTemplateId,
  candyMachine: config.candyMachine,
  collection: config.coreCollection,
  treasury: config.solTreasury,
  mintLimitId: MINT_LIMIT_ID,
  mintSecretKey: readKey(mintSignerPath),
});

console.log(`RPC        ${describeRpc(rpcUrl)}`);
console.log(`Wallet     ${wallet}`);
if (backend.signer !== config.mintSigner) {
  console.error(`The mint signer key is ${backend.signer} but the manifest names ${config.mintSigner}.`);
  process.exit(1);
}

const sale = await backend.sale(wallet);
if (!sale) {
  console.error('The Candy Machine does not exist on this cluster. Run `pnpm devnet:mint-setup` first.');
  process.exit(1);
}
console.log(`Sale       ${sale.itemsRedeemed} of ${sale.itemsAvailable} minted, ${sale.itemsLoaded} loaded, this wallet minted ${sale.mintedByWallet}`);

const prepared = await backend.prepare(wallet);
console.log(`Asset      ${prepared.asset}`);
console.log(`Size       ${prepared.transaction.length} of 1232 bytes`);

const response = await fetch(rpcUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: [
      Buffer.from(prepared.transaction).toString('base64'),
      { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' },
    ],
  }),
});
const body = await response.json();
if (body.error) {
  console.error(`The RPC refused the simulation: ${body.error.message}`);
  process.exit(1);
}
const result = body.result.value;

console.log('\nProgram log');
for (const line of result.logs ?? []) console.log(`  ${line}`);

if (result.err) {
  console.error(`\nThe cluster would refuse this mint: ${JSON.stringify(result.err)}`);
  process.exit(1);
}
const used = result.unitsConsumed;
console.log(`\nAccepted. ${used} compute units used; the transaction asks for ${MINT_COMPUTE_UNIT_LIMIT}.`);
if (used > MINT_COMPUTE_UNIT_LIMIT * 0.8) {
  console.log('That is close to the limit: raise MINT_COMPUTE_UNIT_LIMIT in packages/metaplex-client/src/backend.ts.');
}

// The RPC client keeps its connection pool open, which would hold the process; everything is done.
process.exit(0);
