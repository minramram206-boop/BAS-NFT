#!/usr/bin/env node
/**
 * Devnet market setup, after `PROGRAM=market bash scripts/devnet/deploy.sh`
 * (docs/MARKET.md, D-0086).
 *
 * In order, and skipping whatever is already done, so it is safe to re-run:
 *   1. the market program is deployed and the deployer is its upgrade authority,
 *   2. the collection's Royalties plugin is 500 basis points, paid in full to
 *      `royaltyRecipient`, because the program cannot read collection plugins,
 *   3. the payout account holds at least the rent minimum,
 *   4. initialize_config: 500 bps royalty, no fee, both paid to `royaltyRecipient`,
 *   5. set_paused(false), or set_paused(true) with --pause.
 *
 * Usage (from the repository root, after `pnpm install`):
 *   node scripts/devnet/market-setup.mjs [--keypair .keys/devnet-deployer.json]
 *                                        [--config config/devnet.json] [--rpc <url>] [--pause]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Keypair, MPL_CORE_PROGRAM, PublicKey, createRpc, describeRpc } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientEntry = resolve(repoRoot, 'packages/chain-client/dist/index.js');
if (!existsSync(clientEntry)) {
  console.error('packages/chain-client is not built. Run `pnpm install` (or `pnpm build:packages`) first.');
  process.exit(1);
}
const {
  decodeCollectionRoyalties,
  decodeMarketConfig,
  decodeUpgradeAuthority,
  initializeMarketConfigInstruction,
  marketAuthorityAddress,
  marketConfigAddress,
  programDataAddress,
  setMarketPausedInstruction,
} = await import(pathToFileURL(clientEntry).href);

/** The collection's royalty (SPEC §6.2). The market config must charge the same. */
const ROYALTY_BPS = 500;
/** No market fee on devnet (D-0082). */
const FEE_BPS = 0;

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

const configPath = resolve(repoRoot, option('config', 'config/devnet.json'));
const keypairPath = resolve(repoRoot, option('keypair', '.keys/devnet-deployer.json'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const rpcUrl = option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl);
const wantPaused = process.argv.includes('--pause');

const step = (text) => console.log(`\n▸ ${text}`);
const done = (text) => console.log(`  ✓ ${text}`);
const stop = (lines) => {
  for (const line of [].concat(lines)) console.error(`  ✗ ${line}`);
  process.exit(1);
};

if (!config.marketProgramId) stop(`${configPath} has no marketProgramId.`);
if (!existsSync(keypairPath)) stop([`Deployer keypair not found: ${keypairPath}`, 'It must be the market program upgrade authority.']);

const deployer = Keypair.fromFile(keypairPath);
const rpc = createRpc(rpcUrl);
const programId = config.marketProgramId;
const collection = config.coreCollection;
const recipient = config.royaltyRecipient;

/** `@bas/chain-client` instructions in the shape `solana.mjs` signs. Kit roles are bit flags: 1 writable, 2 signer. */
const toLegacy = (instruction) => ({
  programId: new PublicKey(instruction.programAddress),
  keys: instruction.accounts.map((account) => ({
    pubkey: new PublicKey(account.address),
    isSigner: (account.role & 2) !== 0,
    isWritable: (account.role & 1) !== 0,
  })),
  data: Uint8Array.from(instruction.data),
});
const send = async (instruction) => rpc.send([toLegacy(instruction)], [deployer]);
const sol = (lamports) => `${(Number(lamports) / 1e9).toFixed(4)} SOL`;

console.log(`RPC        ${describeRpc(rpcUrl)}`);
console.log(`Deployer   ${deployer.publicKey}`);
console.log(`Market     ${programId}`);
console.log(`Collection ${collection}`);

step('Market program deployed by this deployer');
const program = await rpc.getAccount(new PublicKey(programId));
if (!program?.executable) stop(`${programId} is not deployed on this cluster. Run PROGRAM=market bash scripts/devnet/deploy.sh first.`);
const programData = await rpc.getAccount(new PublicKey(await programDataAddress(programId)));
const upgradeAuthority = programData ? decodeUpgradeAuthority(programData.data) : null;
if (upgradeAuthority !== deployer.publicKey.toString()) {
  stop(`the upgrade authority is ${upgradeAuthority ?? 'not set'}, not this deployer; only it may initialize the config.`);
}
done('deployed, and this deployer is the upgrade authority');

step('Collection royalty matches the market');
const collectionAccount = await rpc.getAccount(new PublicKey(collection));
if (!collectionAccount || collectionAccount.owner !== MPL_CORE_PROGRAM.toString()) stop(`${collection} is not a Core account.`);
const royalties = decodeCollectionRoyalties(collectionAccount.data);
if (royalties === undefined) stop(`${collection} is not a Core collection.`);
if (royalties === null) stop('the collection has no Royalties plugin. Run `pnpm devnet:mint-setup` first.');
if (royalties.basisPoints !== ROYALTY_BPS) stop(`the collection charges ${royalties.basisPoints} bps; the market would charge ${ROYALTY_BPS}.`);
const creators = royalties.creators.map((creator) => `${creator.address} ${creator.percentage}%`).join(', ');
if (royalties.creators.length !== 1 || royalties.creators[0].address !== recipient || royalties.creators[0].percentage !== 100) {
  stop(`the collection pays ${creators}, but config/devnet.json names ${recipient} as royalty recipient.`);
}
done(`${royalties.basisPoints} bps to ${creators} (rule set: ${royalties.ruleSet})`);

step('Payout account can take small payments');
const [{ value: balance }, rentMinimum] = await Promise.all([
  rpc.call('getBalance', [recipient, { commitment: 'confirmed' }]),
  rpc.call('getMinimumBalanceForRentExemption', [0]),
]);
if (BigInt(balance) < BigInt(rentMinimum)) {
  stop(`${recipient} holds ${sol(balance)}; send it at least ${sol(rentMinimum)} so a 5% royalty never leaves it below rent.`);
}
done(`${recipient} holds ${sol(balance)}`);

step('Market config');
const configAddress = await marketConfigAddress(programId);
let marketConfig = await rpc.getAccount(new PublicKey(configAddress));
if (!marketConfig) {
  const signature = await send(
    await initializeMarketConfigInstruction({
      programId,
      admin: deployer.publicKey.toString(),
      collection,
      royaltyRecipient: recipient,
      feeRecipient: recipient,
      royaltyBps: ROYALTY_BPS,
      feeBps: FEE_BPS,
    }),
  );
  done(`initialized (${signature})`);
  marketConfig = await rpc.getAccount(new PublicKey(configAddress));
}
const current = marketConfig ? decodeMarketConfig(marketConfig.data) : undefined;
if (!current) stop(`${configAddress} is not a MarketConfig account.`);
const expected = {
  admin: deployer.publicKey.toString(),
  collection,
  royaltyBps: ROYALTY_BPS,
  royaltyRecipient: recipient,
  feeBps: FEE_BPS,
  feeRecipient: recipient,
};
const drift = Object.entries(expected).filter(([field, value]) => current[field] !== value);
if (drift.length > 0) {
  stop(drift.map(([field, value]) => `${field} is ${current[field]} on chain, expected ${value}; change it with update_config.`));
}
done(`${configAddress}: ${current.royaltyBps} bps royalty, ${current.feeBps} bps fee, admin ${current.admin}`);

step(wantPaused ? 'Pause the market' : 'Open the market');
if (current.isPaused === wantPaused) {
  done(wantPaused ? 'already paused' : 'already open');
} else {
  const signature = await send(await setMarketPausedInstruction({ programId, admin: deployer.publicKey.toString(), paused: wantPaused }));
  done(`${wantPaused ? 'paused' : 'open'} (${signature})`);
}

console.log(`\nSellers delegate transfers to ${await marketAuthorityAddress(programId)}.`);
console.log(wantPaused ? 'Listing and buying are refused until this runs again without --pause.' : 'Citizens can now be listed and bought on /market.');
