#!/usr/bin/env node
/**
 * Devnet setup after `solana program deploy` (D-0016, D-0017, D-0027).
 *
 * In order, and skipping whatever is already done, so it is safe to re-run:
 *   1. mission authority and SOL treasury keys,
 *   2. the utility token mirror: a Token-2022 mint with 6 decimals, plus test
 *      tokens for the deployer,
 *   3. the Metaplex Core collection,
 *   4. initialize_config, set_utility_mint, lock_utility_mint, then unpause.
 * Every new address is written back into config/devnet.json.
 *
 * Usage (from the repository root):
 *   node scripts/devnet/setup.mjs [--keypair .keys/devnet-deployer.json]
 *                                 [--config config/devnet.json] [--rpc <url>]
 *
 * The deployer keypair must be the program's upgrade authority, because only
 * that key may run initialize_config.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  Keypair,
  MPL_CORE_PROGRAM,
  PublicKey,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  UPGRADEABLE_LOADER,
  associatedTokenAddress,
  borshString,
  createRpc,
  findProgramAddress,
  u32,
  u64,
  u8,
} from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the devnet web app will serve metadata (D-0024 item 6). */
const DEVNET_METADATA_PREFIX = 'https://bas-district-devnet.vercel.app/templates/7/';
const COLLECTION_NAME = 'BAS District Devnet';
/** One million tokens for trying training on devnet. */
const TEST_TOKEN_ATOMS = 1_000_000n * 10n ** 6n;

/** Placeholders shipped in config/devnet.json; see packages/config/src/readiness.ts. */
const PLACEHOLDERS = new Set([
  'D8HGhXUqHx7UXysCMEBDzvd3FS4XGEMNjCR6Eaj8CRbV',
  '6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG',
  'BASCo11ect1onDevnet1111111111111111111111111',
  'BASTreasuryDevnet11111111111111111111111111',
  'A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn',
]);

// --- arguments and files -------------------------------------------------------

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const configPath = resolve(repoRoot, option('config', 'config/devnet.json'));
const keypairPath = resolve(repoRoot, option('keypair', '.keys/devnet-deployer.json'));
const keysDir = dirname(keypairPath);

const rawConfig = readFileSync(configPath, 'utf8');
const eol = rawConfig.includes('\r\n') ? '\r\n' : '\n';
const config = JSON.parse(rawConfig);
const rpcUrl = option('rpc', config.rpcUrl);

function saveConfig() {
  writeFileSync(configPath, JSON.stringify(config, null, 2).replace(/\n/g, eol) + eol);
}

function saveKeypair(name, keypair) {
  mkdirSync(keysDir, { recursive: true });
  const path = resolve(keysDir, name);
  if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite a key`);
  writeFileSync(path, keypair.toFileContent(), { mode: 0o600 });
  return path;
}

const isPlaceholder = (value) => PLACEHOLDERS.has(value);
const step = (text) => console.log(`\n▸ ${text}`);
const done = (text) => console.log(`  ✓ ${text}`);

if (!existsSync(keypairPath)) {
  console.error(`Deployer keypair not found: ${keypairPath}`);
  console.error('Create it with: solana-keygen new -o .keys/devnet-deployer.json');
  process.exit(1);
}
const deployer = Keypair.fromFile(keypairPath);
const rpc = createRpc(rpcUrl);
const programId = new PublicKey(config.districtProgramId);

// --- district instructions (discriminators from the program IDL) -----------------

const DISCRIMINATORS = {
  initializeConfig: [208, 127, 21, 1, 194, 190, 196, 70],
  setUtilityMint: [107, 18, 251, 61, 240, 254, 141, 211],
  lockUtilityMint: [237, 125, 89, 117, 91, 97, 37, 88],
  setPaused: [91, 60, 125, 192, 176, 225, 166, 218],
};

const [configPda] = findProgramAddress([Buffer.from('district_config')], programId);
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

/** Fields of `DistrictConfig` the setup reads, by byte offset after the discriminator. */
function readDistrictConfig(data) {
  const key = (offset) => new PublicKey(data.subarray(offset, offset + 32));
  return {
    admin: key(9),
    utilityMint: key(169),
    utilityMintLocked: data[201] === 1,
    isPaused: data[218] === 1,
  };
}

// --- main ----------------------------------------------------------------------

console.log(`RPC        ${rpcUrl}`);
console.log(`Deployer   ${deployer.publicKey}`);
console.log(`Program    ${programId}`);

const balance = await rpc.call('getBalance', [deployer.publicKey.toString(), { commitment: 'confirmed' }]);
console.log(`Balance    ${(balance.value / 1e9).toFixed(4)} SOL`);

step('Program deployed by this deployer');
const programAccount = await rpc.getAccount(programId);
if (!programAccount?.executable) {
  throw new Error(`program ${programId} is not deployed on ${rpcUrl}. Run scripts/devnet/deploy.sh first.`);
}
const [programData] = findProgramAddress([programId.bytes], UPGRADEABLE_LOADER);
const programDataAccount = await rpc.getAccount(programData);
const authority = programDataAccount?.data[12] === 1 ? new PublicKey(programDataAccount.data.subarray(13, 45)) : null;
if (!authority?.equals(deployer.publicKey)) {
  throw new Error(`upgrade authority is ${authority ?? 'none'}, not the deployer ${deployer.publicKey}`);
}
done(`upgrade authority is the deployer`);

step('Mission authority and SOL treasury');
if (isPlaceholder(config.missionAuthority)) {
  const missionAuthority = Keypair.generate();
  const path = saveKeypair('devnet-mission-authority.json', missionAuthority);
  config.missionAuthority = missionAuthority.publicKey.toString();
  saveConfig();
  done(`new mission authority ${config.missionAuthority}, key saved to ${path}`);
} else done(`mission authority ${config.missionAuthority}`);
if (isPlaceholder(config.solTreasury)) {
  config.solTreasury = deployer.publicKey.toString();
  saveConfig();
}
done(`SOL treasury ${config.solTreasury}`);

step('Metadata prefix');
if (new URL(config.approvedTemplateUriPrefix).hostname.endsWith('.invalid')) {
  config.approvedTemplateUriPrefix = DEVNET_METADATA_PREFIX;
  saveConfig();
}
done(config.approvedTemplateUriPrefix);

step('Utility token mirror (Token-2022, 6 decimals)');
if (isPlaceholder(config.utilityTokenMint) || !(await rpc.getAccount(new PublicKey(config.utilityTokenMint)))) {
  const mint = Keypair.generate();
  const space = 82;
  const rent = await rpc.call('getMinimumBalanceForRentExemption', [space]);
  const ata = associatedTokenAddress(deployer.publicKey, mint.publicKey);
  await rpc.send(
    [
      {
        programId: SYSTEM_PROGRAM,
        keys: [meta(deployer.publicKey, true, true), meta(mint.publicKey, true, true)],
        data: Buffer.concat([u32(0), u64(rent), u64(space), TOKEN_2022_PROGRAM.bytes]),
      },
      {
        // InitializeMint2: decimals, mint authority, no freeze authority
        programId: TOKEN_2022_PROGRAM,
        keys: [meta(mint.publicKey, false, true)],
        data: Buffer.concat([u8(20), u8(config.tokenDecimals), deployer.publicKey.bytes, u8(0)]),
      },
      {
        // CreateIdempotent
        programId: ASSOCIATED_TOKEN_PROGRAM,
        keys: [
          meta(deployer.publicKey, true, true),
          meta(ata, false, true),
          meta(deployer.publicKey, false, false),
          meta(mint.publicKey, false, false),
          meta(SYSTEM_PROGRAM, false, false),
          meta(TOKEN_2022_PROGRAM, false, false),
        ],
        data: u8(1),
      },
      {
        // MintTo
        programId: TOKEN_2022_PROGRAM,
        keys: [meta(mint.publicKey, false, true), meta(ata, false, true), meta(deployer.publicKey, true, false)],
        data: Buffer.concat([u8(7), u64(TEST_TOKEN_ATOMS)]),
      },
    ],
    [deployer, mint],
  );
  config.utilityTokenMint = mint.publicKey.toString();
  saveConfig();
  done(`mint ${config.utilityTokenMint}, 1,000,000 tokens in ${ata}`);
} else done(`mint ${config.utilityTokenMint}`);

step('Metaplex Core collection');
if (isPlaceholder(config.coreCollection) || !(await rpc.getAccount(new PublicKey(config.coreCollection)))) {
  const collection = Keypair.generate();
  await rpc.send(
    [
      {
        // CreateCollectionV1 { name, uri, plugins: None }
        programId: MPL_CORE_PROGRAM,
        keys: [
          meta(collection.publicKey, true, true),
          meta(deployer.publicKey, false, false),
          meta(deployer.publicKey, true, true),
          meta(SYSTEM_PROGRAM, false, false),
        ],
        data: Buffer.concat([
          u8(1),
          borshString(COLLECTION_NAME),
          borshString(`${config.approvedTemplateUriPrefix}collection.json`),
          u8(0),
        ]),
      },
    ],
    [deployer, collection],
  );
  config.coreCollection = collection.publicKey.toString();
  saveConfig();
  done(`collection ${config.coreCollection}`);
} else done(`collection ${config.coreCollection}`);

step('initialize_config');
let state = await rpc.getAccount(configPda);
if (!state) {
  const [template] = findProgramAddress(
    [Buffer.from('approved_template'), u32(config.approvedTemplateId)],
    programId,
  );
  await rpc.send(
    [
      {
        programId,
        keys: [
          meta(configPda, false, true),
          meta(template, false, true),
          meta(programData, false, false),
          meta(deployer.publicKey, true, true),
          meta(SYSTEM_PROGRAM, false, false),
        ],
        data: Buffer.concat([
          Uint8Array.from(DISCRIMINATORS.initializeConfig),
          new PublicKey(config.missionAuthority).bytes,
          new PublicKey(config.solTreasury).bytes,
          new PublicKey(config.coreCollection).bytes,
          u32(config.approvedTemplateId),
          borshString(config.approvedTemplateUriPrefix),
          u64(config.baseTrainingCostAtoms),
        ]),
      },
    ],
    [deployer],
  );
  state = await rpc.getAccount(configPda);
  done(`config ${configPda} created, district paused`);
} else done(`config ${configPda} already exists`);

let district = readDistrictConfig(state.data);
if (!district.admin.equals(deployer.publicKey)) {
  throw new Error(`district admin is ${district.admin}, not the deployer; run the remaining steps with that key`);
}
const adminOnly = (name, args = []) => ({
  programId,
  keys: [meta(configPda, false, true), meta(deployer.publicKey, true, false)],
  data: Buffer.concat([Uint8Array.from(DISCRIMINATORS[name]), ...args]),
});

step('set_utility_mint and lock_utility_mint');
if (!district.utilityMint.equals(new PublicKey(config.utilityTokenMint))) {
  if (district.utilityMintLocked) throw new Error(`utility mint is locked to ${district.utilityMint}`);
  await rpc.send(
    [
      {
        programId,
        keys: [
          meta(configPda, false, true),
          meta(new PublicKey(config.utilityTokenMint), false, false),
          meta(deployer.publicKey, true, false),
        ],
        data: Buffer.concat([Uint8Array.from(DISCRIMINATORS.setUtilityMint), u8(config.tokenDecimals)]),
      },
    ],
    [deployer],
  );
  done(`utility mint set to ${config.utilityTokenMint}`);
}
district = readDistrictConfig((await rpc.getAccount(configPda)).data);
if (!district.utilityMintLocked) {
  await rpc.send([adminOnly('lockUtilityMint')], [deployer]);
  done('utility mint locked');
} else done('utility mint already locked');

step('Unpause');
district = readDistrictConfig((await rpc.getAccount(configPda)).data);
if (district.isPaused) {
  await rpc.send([adminOnly('setPaused', [u8(0)])], [deployer]);
  done('district is live');
} else done('district already live');

console.log(`\nDone. config/devnet.json now holds the devnet addresses.`);
console.log('Still placeholders until the mint step: candyMachine, candyGuard, royaltyRecipient.');
