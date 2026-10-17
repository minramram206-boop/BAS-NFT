#!/usr/bin/env node
/**
 * Devnet public sale setup, after `scripts/devnet/setup.mjs` (D-0061).
 *
 * In order, and skipping whatever is already done, so it is safe to re-run or
 * to resume after a failed transaction:
 *   1. the mint signer key (the Candy Guard `thirdPartySigner`) and the royalty recipient,
 *   2. the Royalties plugin of the Core collection (SPEC §6.2: 500 basis points),
 *   3. the Core Candy Machine and its Candy Guard: 0.01 SOL to the treasury,
 *      one mint per wallet, the backend signer, no bot tax on devnet,
 *   4. the roster as config lines, ten per transaction.
 * The machine address and the guard are written back into config/devnet.json.
 *
 * The sale holds the roster only (content/en/citizens.json): those are the
 * citizens the app can show. The archive stays out until its art is ready.
 *
 * Usage (from the repository root, after `pnpm install`):
 *   node scripts/devnet/mint-setup.mjs [--keypair .keys/devnet-deployer.json]
 *                                      [--mint-signer-key .keys/devnet-mint-signer.json]
 *                                      [--config config/devnet.json] [--rpc <url>]
 *
 * The deployer must be the update authority of the collection, which is how
 * scripts/devnet/setup.mjs creates it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeRpc } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const metaplexEntry = resolve(repoRoot, 'packages/metaplex-client/dist/index.js');
if (!existsSync(metaplexEntry)) {
  console.error('packages/metaplex-client is not built. Run `pnpm install` (or `pnpm build:packages`) first.');
  process.exit(1);
}
const chainEntry = resolve(repoRoot, 'packages/chain-client/dist/index.js');
if (!existsSync(chainEntry)) {
  console.error('packages/chain-client is not built. Run `pnpm install` (or `pnpm build:packages`) first.');
  process.exit(1);
}
const { prizeVaultAddress } = await import(pathToFileURL(chainEntry).href);
const {
  MINT_LIMIT_ID,
  ROYALTY_BASIS_POINTS,
  buildAddItems,
  buildAddRoyalties,
  buildCreateSale,
  buildUpdateSaleGuards,
  candyGuardOf,
  createMetaplexContext,
  newSigner,
  readRoyalties,
  readSale,
  signerFromSecretKey,
  splitMintPayment,
  useSigner,
} = await import(pathToFileURL(metaplexEntry).href);

/** Placeholders shipped in config/devnet.json; see packages/config/src/readiness.ts. */
const PLACEHOLDERS = new Set([
  'BASCo11ect1onDevnet1111111111111111111111111',
  'BASCandyMach1neDevnet1111111111111111111111',
  'BASTreasuryDevnet11111111111111111111111111',
  'D1ZevHcBHGmYAMVWVXbRjMBfqGLttvw1k1XHup563HT5',
  'Ajq1yqiok35wbd3uu9carDA9YqTt4t5V3hW3Q9YETVhD',
  'FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk',
]);

// --- arguments and files -------------------------------------------------------

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const configPath = resolve(repoRoot, option('config', 'config/devnet.json'));
const keypairPath = resolve(repoRoot, option('keypair', '.keys/devnet-deployer.json'));
const mintSignerPath = resolve(repoRoot, option('mint-signer-key', '.keys/devnet-mint-signer.json'));

const rawConfig = readFileSync(configPath, 'utf8');
const eol = rawConfig.includes('\r\n') ? '\r\n' : '\n';
const config = JSON.parse(rawConfig);
const rpcUrl = option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl);

function saveConfig() {
  writeFileSync(configPath, JSON.stringify(config, null, 2).replace(/\n/g, eol) + eol);
}

const isPlaceholder = (value) => PLACEHOLDERS.has(value);
const step = (text) => console.log(`\n▸ ${text}`);
const done = (text) => console.log(`  ✓ ${text}`);

function readSecretKey(path) {
  const bytes = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`${path} is not a solana-keygen keypair file`);
  return Uint8Array.from(bytes);
}

if (!existsSync(keypairPath)) {
  console.error(`Deployer keypair not found: ${keypairPath}`);
  console.error('Run scripts/devnet/setup.mjs first; it needs the same key.');
  process.exit(1);
}
if (isPlaceholder(config.coreCollection)) {
  console.error('config/devnet.json still holds a placeholder collection. Run `pnpm devnet:setup` first.');
  process.exit(1);
}

const umi = createMetaplexContext(rpcUrl);
const deployer = signerFromSecretKey(umi, readSecretKey(keypairPath));
useSigner(umi, deployer);

async function send(builder, label) {
  const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
  if (result.result.value.err) throw new Error(`${label} failed: ${JSON.stringify(result.result.value.err)}`);
}

/** The roster as sale items, named and filed the way scripts/gen-metadata.mjs writes them. */
function rosterItems() {
  const citizens = JSON.parse(readFileSync(resolve(repoRoot, 'content/en/citizens.json'), 'utf8'));
  const folder = resolve(repoRoot, `apps/web/public/templates/${config.approvedTemplateId}`);
  const items = citizens
    .map((citizen) => ({
      name: `${citizen.name} ${citizen.code}`,
      file: `${String(citizen.id).padStart(3, '0')}-${citizen.roleKey}.json`,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  for (const item of items) {
    if (!existsSync(resolve(folder, item.file))) {
      throw new Error(`${item.file} is missing in ${folder}. Run \`pnpm metadata\` first.`);
    }
  }
  return items;
}

// --- main ----------------------------------------------------------------------

console.log(`RPC        ${describeRpc(rpcUrl)}`);
console.log(`Deployer   ${deployer.publicKey}`);
const balance = await umi.rpc.getBalance(deployer.publicKey);
console.log(`Balance    ${(Number(balance.basisPoints) / 1e9).toFixed(4)} SOL`);

step('Mint signer and royalty recipient');
if (isPlaceholder(config.mintSigner)) {
  if (existsSync(mintSignerPath)) throw new Error(`${mintSignerPath} already exists; refusing to overwrite a key`);
  const signer = newSigner(umi);
  mkdirSync(dirname(mintSignerPath), { recursive: true });
  writeFileSync(mintSignerPath, `${JSON.stringify([...signer.secretKey])}\n`, { mode: 0o600 });
  config.mintSigner = signer.publicKey;
  saveConfig();
  done(`new mint signer ${config.mintSigner}, key saved to ${mintSignerPath}`);
} else {
  if (existsSync(mintSignerPath)) {
    const onDisk = signerFromSecretKey(umi, readSecretKey(mintSignerPath)).publicKey;
    if (onDisk !== config.mintSigner) throw new Error(`${mintSignerPath} is ${onDisk} but the manifest names ${config.mintSigner}`);
  }
  done(`mint signer ${config.mintSigner}`);
}
if (isPlaceholder(config.royaltyRecipient)) {
  config.royaltyRecipient = deployer.publicKey;
  saveConfig();
}
done(`royalty recipient ${config.royaltyRecipient}`);

step(`Royalties on the collection (${ROYALTY_BASIS_POINTS} basis points)`);
const royalties = await readRoyalties(umi, config.coreCollection);
if (!royalties) {
  await send(buildAddRoyalties(umi, { collection: config.coreCollection, recipient: config.royaltyRecipient }), 'adding royalties');
  done('plugin added');
} else done('plugin already present');
const placed = await readRoyalties(umi, config.coreCollection);
const creator = placed?.creators[0];
if (placed?.basisPoints !== ROYALTY_BASIS_POINTS || placed.creators.length !== 1 || creator?.address !== config.royaltyRecipient || creator.percentage !== 100) {
  throw new Error(`the collection royalties are ${JSON.stringify(placed)}, not ${ROYALTY_BASIS_POINTS} bps to ${config.royaltyRecipient}`);
}
done(`${placed.basisPoints} bps to ${creator.address}`);

const items = rosterItems();
const prizeVault = config.prizeVaultProgramId ? await prizeVaultAddress(config.prizeVaultProgramId) : undefined;
const prizeShareBps = config.mintPrizeShareBps ?? 0;
const guards = {
  priceLamports: BigInt(config.mintPriceLamports),
  treasury: config.solTreasury,
  ...(prizeVault && prizeShareBps > 0 ? { prizeVault, prizeShareBps } : {}),
  mintLimitPerWallet: config.mintLimitPerWallet,
  mintLimitId: MINT_LIMIT_ID,
  mintSigner: config.mintSigner,
};

async function readExistingSale() {
  try {
    return await readSale(umi, { candyMachine: config.candyMachine, mintLimitId: MINT_LIMIT_ID, wallet: deployer.publicKey });
  } catch (error) {
    throw new Error(
      `${config.candyMachine} exists but is not a complete Candy Machine (${error instanceof Error ? error.message : error}). ` +
        'Put the placeholder BASCandyMach1neDevnet1111111111111111111111 back into candyMachine in config/devnet.json and run again.',
    );
  }
}

step('Candy Machine and Candy Guard');
let sale = isPlaceholder(config.candyMachine) ? undefined : await readExistingSale();
if (!sale) {
  const machine = newSigner(umi);
  const builder = await buildCreateSale(umi, {
    candyMachine: machine,
    collection: config.coreCollection,
    collectionUpdateAuthority: deployer,
    uriPrefix: config.approvedTemplateUriPrefix,
    items,
    guards,
  });
  // Record the address first: if a later transaction fails, a re-run resumes with this machine.
  config.candyMachine = machine.publicKey;
  config.candyGuard = candyGuardOf(umi, machine.publicKey);
  saveConfig();
  for (const [index, part] of (await splitBuilder(builder)).entries()) await send(part, `creating the sale (${index + 1})`);
  sale = await readExistingSale();
  done(`machine ${config.candyMachine}, guard ${config.candyGuard}`);
} else {
  config.candyGuard = candyGuardOf(umi, config.candyMachine);
  saveConfig();
  await send(buildUpdateSaleGuards(umi, { candyGuard: config.candyGuard, authority: deployer, guards }), 'updating the guard');
  const { treasuryLamports, prizeVaultLamports } = splitMintPayment(guards.priceLamports, guards.prizeShareBps ?? 0);
  done(
    `machine ${config.candyMachine}, guard ${config.candyGuard} (${Number(treasuryLamports) / 1e9} SOL treasury, ${Number(prizeVaultLamports) / 1e9} SOL prize vault)`,
  );
}

async function splitBuilder(builder) {
  // One transaction when it fits, otherwise one instruction per transaction, in order.
  if (await builder.fitsInOneTransaction(umi)) return [builder];
  return builder.items.map((item) => builder.empty().add(item));
}

step(`Roster as config lines (${items.length} citizens)`);
if (sale.itemsAvailable !== items.length) {
  throw new Error(
    `the machine holds ${sale.itemsAvailable} items but the roster has ${items.length}. ` +
      'A Candy Machine cannot change its size; point config/devnet.json at a placeholder candyMachine to create a new one.',
  );
}
const batches = buildAddItems(umi, config.candyMachine, items, sale.itemsLoaded);
for (const [index, batch] of batches.entries()) await send(batch, `loading items (${index + 1}/${batches.length})`);
done(batches.length === 0 ? `all ${items.length} lines were already loaded` : `${batches.length} transaction(s)`);

step('Check');
sale = await readExistingSale();
const problems = [];
if (sale.itemsLoaded !== items.length) problems.push(`only ${sale.itemsLoaded} of ${items.length} lines are loaded`);
if (sale.collection !== config.coreCollection) problems.push(`the machine mints into ${sale.collection}`);
if (sale.mintAuthority !== config.candyGuard) problems.push(`the machine mint authority is ${sale.mintAuthority}, not the guard ${config.candyGuard}`);
if (problems.length > 0) throw new Error(`the sale is not ready: ${problems.join('; ')}`);
done(`${sale.itemsAvailable} citizens for sale, ${sale.itemsRedeemed} minted, guard is the mint authority`);

console.log('\nDone. config/devnet.json now holds the sale addresses.');
console.log(`Give the mission server the mint signer key: MINT_SIGNER_KEYPAIR_FILE=${mintSignerPath}`);
if (config.maxSupply !== items.length) {
  console.log(
    `Note: maxSupply in the manifest is ${config.maxSupply}, but the devnet sale holds the ${items.length} roster citizens; ` +
      'the app reads the real supply from the machine.',
  );
}

// The RPC client keeps its connection pool open, which would hold the process; everything is done.
process.exit(0);
