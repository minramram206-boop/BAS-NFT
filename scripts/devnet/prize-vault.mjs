#!/usr/bin/env node
/**
 * The season prize vault on devnet (docs/PRIZE_VAULT.md, D-0101), after
 * `PROGRAM=prize_vault bash scripts/devnet/deploy.sh`.
 *
 *   status                  the vault, the config and this season's account (default)
 *   setup [--deposit <sol>] [--fund <sol>]
 *                           opens the vault (only the upgrade authority may), sends
 *                           <sol> into it the way Pump.fun's fee sharing will, and
 *                           sets <sol> of it aside for the season in .env
 *   finalize [--dry-run]    after the season: ranks its standings, pays each citizen's
 *                           owner now, publishes the winners root and writes the list
 *                           the mission server serves to the web app
 *   rollover                after the dispute window: gives back to the pool the part of
 *                           the season's funding no winner holds. Prizes are never taken
 *                           back; a winner can claim theirs at any time (D-0102)
 *
 * The season is the mission server's: SEASON_ID, SEASON_STARTS_AT, SEASON_DAYS
 * and SEASON_DAY_SECONDS from .env, so the vault ends it when the missions do.
 *
 * Usage (from the repository root, after `pnpm install`):
 *   node --env-file-if-exists=.env scripts/devnet/prize-vault.mjs <command> [options]
 *        [--keypair .keys/devnet-deployer.json] [--config config/devnet.json] [--rpc <url>]
 *        [--season <id>] [--server http://localhost:8787]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Keypair, PublicKey, SYSTEM_PROGRAM, createRpc, describeRpc, u32, u64 } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientEntry = resolve(repoRoot, 'packages/chain-client/dist/index.js');
if (!existsSync(clientEntry)) {
  console.error('packages/chain-client is not built. Run `pnpm install` (or `pnpm build:packages`) first.');
  process.exit(1);
}
const client = await import(pathToFileURL(clientEntry).href);
const {
  PRIZE_VAULT_LENGTH,
  auctionAddress,
  bracketOfStats,
  buildPrizeTree,
  citizenStateAddress,
  decodeAuction,
  decodeCitizenState,
  decodeCoreAsset,
  decodePrizeConfig,
  decodeSeason,
  decodeUpgradeAuthority,
  finalizeWinnersInstruction,
  fundSeasonInstruction,
  initializePrizeVaultInstruction,
  marketAuthorityAddress,
  prizeConfigAddress,
  prizeVaultAddress,
  programDataAddress,
  rolloverSeasonInstruction,
  seasonAddress,
  seasonPrizeRows,
  seasonPrizeStage,
  toHex,
  unallocatedLamports,
} = client;

const SOL = 1_000_000_000;
const DAY_SECONDS = 86_400;

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'status';
const configPath = resolve(repoRoot, option('config', 'config/devnet.json'));
const keypairPath = resolve(repoRoot, option('keypair', '.keys/devnet-deployer.json'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const rpcUrl = option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl);
const serverUrl = option('server', process.env.NEXT_PUBLIC_MISSION_SERVER_URL || 'http://localhost:8787');
const prizesDir = resolve(repoRoot, process.env.PRIZES_DIR || 'apps/mission-server/data/prizes');

const step = (text) => console.log(`\n▸ ${text}`);
const done = (text) => console.log(`  ✓ ${text}`);
const stop = (lines) => {
  for (const line of [].concat(lines)) console.error(`  ✗ ${line}`);
  process.exit(1);
};
const sol = (lamports) => `${(Number(lamports) / SOL).toFixed(4)} SOL`;
const when = (seconds) => new Date(seconds * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB';

function wholeNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback === undefined) stop(`${name} is not set in .env; the vault takes the mission server's season.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) stop(`${name} must be a whole number.`);
  return value;
}

if (!['status', 'setup', 'finalize', 'rollover'].includes(command)) stop(`unknown command ${command}; use status, setup, finalize or rollover.`);
if (!config.prizeVaultProgramId) stop(`${configPath} has no prizeVaultProgramId.`);
if (!existsSync(keypairPath)) stop(`Keypair not found: ${keypairPath}`);

const signer = Keypair.fromFile(keypairPath);
const rpc = createRpc(rpcUrl);
const programId = config.prizeVaultProgramId;
const seasonId = Number(option('season', wholeNumber('SEASON_ID', 1)));
const seasonEndsAt = () =>
  wholeNumber('SEASON_STARTS_AT') + wholeNumber('SEASON_DAYS', 28) * wholeNumber('SEASON_DAY_SECONDS', DAY_SECONDS);

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
const send = async (instruction) => rpc.send([toLegacy(instruction)], [signer]);
const balanceOf = async (key) => BigInt((await rpc.call('getBalance', [key, { commitment: 'confirmed' }])).value);
const now = async () => {
  const slot = await rpc.call('getSlot', [{ commitment: 'confirmed' }]);
  return (await rpc.call('getBlockTime', [slot])) ?? Math.floor(Date.now() / 1000);
};

const [configAddress, vaultAddress, seasonKey] = await Promise.all([
  prizeConfigAddress(programId),
  prizeVaultAddress(programId),
  seasonAddress(programId, seasonId),
]);

async function readState() {
  const [configAccount, seasonAccount, vaultLamports, vaultRent] = await Promise.all([
    rpc.getAccount(new PublicKey(configAddress)),
    rpc.getAccount(new PublicKey(seasonKey)),
    balanceOf(vaultAddress),
    rpc.call('getMinimumBalanceForRentExemption', [PRIZE_VAULT_LENGTH]),
  ]);
  return {
    prizeConfig: configAccount ? decodePrizeConfig(configAccount.data) : undefined,
    season: seasonAccount ? decodeSeason(seasonAccount.data) : undefined,
    vaultLamports,
    vaultRent: BigInt(vaultRent),
  };
}

function printState({ prizeConfig, season, vaultLamports, vaultRent }, at) {
  console.log(`  vault      ${vaultAddress}: ${sol(vaultLamports)}`);
  if (!prizeConfig) {
    console.log('  config     not opened yet (run setup)');
    return;
  }
  console.log(`  authority  ${prizeConfig.authority}${prizeConfig.pendingAuthority ? ` (proposed: ${prizeConfig.pendingAuthority})` : ''}`);
  console.log(`  reserved   ${sol(prizeConfig.reservedLamports)} for seasons, ${sol(unallocatedLamports(vaultLamports, vaultRent, prizeConfig))} unallocated`);
  console.log(`  paid       ${sol(prizeConfig.paidLamports)} to winners so far`);
  if (!season) {
    console.log(`  season ${seasonId}   not funded yet`);
    return;
  }
  console.log(`  season ${seasonId}   ${sol(season.fundedLamports)} funded, ends ${when(season.endsAt)}, ${seasonPrizeStage(season, at)}`);
  if (season.finalizedAt) {
    console.log(`             ${season.winners} winners, ${sol(season.prizesLamports)} in prizes, ${sol(season.claimedLamports)} claimed`);
    console.log(`             claims open ${when(season.claimsOpenAt)}, with no deadline`);
    console.log(`             leftover ${sol(season.fundedLamports - season.prizesLamports)} ${season.leftoverReleased ? 'back in the pool' : 'not rolled over yet'}`);
  }
}

console.log(`RPC        ${describeRpc(rpcUrl)}`);
console.log(`Signer     ${signer.publicKey}`);
console.log(`Program    ${programId}`);
console.log(`Season     ${seasonId}`);

step('Prize vault program deployed');
const program = await rpc.getAccount(new PublicKey(programId));
if (!program?.executable) stop(`${programId} is not deployed on this cluster. Run PROGRAM=prize_vault bash scripts/devnet/deploy.sh first.`);
done('deployed');

let state = await readState();

if (command === 'status') {
  step('State');
  printState(state, await now());
}

if (command === 'setup') {
  step('Vault');
  if (state.prizeConfig) {
    done(`open since earlier, authority ${state.prizeConfig.authority}`);
  } else {
    const programData = await rpc.getAccount(new PublicKey(await programDataAddress(programId)));
    const upgradeAuthority = programData ? decodeUpgradeAuthority(programData.data) : null;
    if (upgradeAuthority !== signer.publicKey.toString()) {
      stop(`the upgrade authority is ${upgradeAuthority ?? 'not set'}, not this key; only it may open the vault.`);
    }
    const signature = await send(await initializePrizeVaultInstruction({ programId, authority: signer.publicKey.toString() }));
    done(`opened (${signature})`);
    state = await readState();
  }

  const deposit = Number(option('deposit', '0'));
  if (deposit > 0) {
    step(`Deposit ${deposit} SOL, as fee sharing would`);
    const lamports = BigInt(Math.round(deposit * SOL));
    // A plain system transfer, exactly what Pump.fun's distribute_creator_fees sends.
    const signature = await rpc.send(
      [
        {
          programId: SYSTEM_PROGRAM,
          keys: [
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: new PublicKey(vaultAddress), isSigner: false, isWritable: true },
          ],
          data: Uint8Array.from(Buffer.concat([u32(2), u64(lamports)])),
        },
      ],
      [signer],
    );
    done(`sent ${sol(lamports)} (${signature})`);
    state = await readState();
  }

  const fund = Number(option('fund', '0'));
  if (fund > 0) {
    step(`Fund season ${seasonId} with ${fund} SOL`);
    const endsAt = state.season?.endsAt ?? seasonEndsAt();
    if (state.season && state.season.endsAt !== seasonEndsAt()) {
      console.log(`  ! the season account ends ${when(state.season.endsAt)}; .env now says ${when(seasonEndsAt())}. The account's end stays.`);
    }
    const signature = await send(
      await fundSeasonInstruction({
        programId,
        authority: signer.publicKey.toString(),
        seasonId,
        amountLamports: BigInt(Math.round(fund * SOL)),
        endsAt,
      }),
    );
    done(`funded (${signature})`);
    state = await readState();
  }

  step('State');
  printState(state, await now());
}

if (command === 'finalize') {
  const dryRun = process.argv.includes('--dry-run');
  const at = await now();
  const { season } = state;
  if (!season) stop(`season ${seasonId} was never funded; there is nothing to pay.`);
  if (at < season.endsAt) stop(`season ${seasonId} ends ${when(season.endsAt)}; winners can be published after that.`);
  if (season.finalizedAt && at >= season.claimsOpenAt) stop('claims are already open; the published list can no longer change.');

  step(`Standings from ${serverUrl}`);
  const response = await fetch(`${serverUrl}/season/standings`).catch(() => null);
  if (!response?.ok) stop(`could not read ${serverUrl}/season/standings; is the mission server running on season ${seasonId}?`);
  const seasonInfo = await (await fetch(`${serverUrl}/season`)).json();
  if (seasonInfo.id !== seasonId) stop(`the mission server runs season ${seasonInfo.id}, not ${seasonId}.`);
  const { standings } = await response.json();
  done(`${standings.length} citizens with points`);

  step('Who holds each citizen now, and its bracket');
  const marketAuthority = config.marketProgramId ? await marketAuthorityAddress(config.marketProgramId) : null;
  const entries = [];
  for (const { asset, points, masterEligible } of standings) {
    const [assetAccount, stateAccount] = await Promise.all([
      rpc.getAccount(new PublicKey(asset)),
      rpc.getAccount(new PublicKey(await citizenStateAddress(config.districtProgramId, asset))),
    ]);
    const core = assetAccount ? decodeCoreAsset(assetAccount.data) : undefined;
    const citizen = stateAccount ? decodeCitizenState(stateAccount.data) : undefined;
    if (!core || core.collection !== config.coreCollection || !citizen) {
      console.log(`  - ${asset}: not a registered citizen of the collection any more, left out`);
      continue;
    }
    let owner = core.owner;
    // An auctioned citizen sits with the market; its prize goes to the seller who still owns it.
    if (owner === marketAuthority) {
      const auction = await rpc.getAccount(new PublicKey(await auctionAddress(config.marketProgramId, asset)));
      const seller = auction ? decodeAuction(auction.data)?.seller : undefined;
      if (!seller) {
        console.log(`  - ${asset}: held by the market without an auction, left out`);
        continue;
      }
      owner = seller;
    }
    entries.push({ asset, owner, points, bracket: bracketOfStats(citizen, Boolean(masterEligible)) });
  }
  done(`${entries.length} entries`);

  const rows = seasonPrizeRows(season.fundedLamports, entries);
  // With no pool at five entries nobody wins; the season is published empty so its funding can roll over.
  const tree = rows.length > 0 ? await buildPrizeTree(seasonId, rows) : { root: new Uint8Array(32) };
  if (rows.length === 0) console.log('\n  No pool has five entries with points, so nobody wins this season.');
  const prizesLamports = rows.reduce((sum, row) => sum + row.amountLamports, 0n);

  step(`Winners of season ${seasonId}`);
  for (const row of rows) {
    console.log(`  #${String(row.index).padStart(2)} ${row.pool.padEnd(7)} ${String(row.rank).padStart(2)}. ${row.winner}  ${sol(row.amountLamports)}  (${row.asset})`);
  }
  console.log(`  total ${sol(prizesLamports)} of ${sol(season.fundedLamports)} funded; the rest rolls over`);
  console.log(`  root  ${toHex(tree.root)}`);
  if (dryRun) {
    console.log('\n--dry-run: nothing sent, nothing written.');
    process.exit(0);
  }

  step('Publish the winners on chain');
  const signature = await send(
    await finalizeWinnersInstruction({
      programId,
      authority: signer.publicKey.toString(),
      seasonId,
      winnersRoot: tree.root,
      winners: rows.length,
      prizesLamports,
    }),
  );
  done(`published (${signature})`);

  if (rows.length === 0) {
    console.log('\nNo winners to list. After the dispute window, `rollover` puts the whole season back in the pool.');
    process.exit(0);
  }

  step('Hand the list to the mission server');
  mkdirSync(prizesDir, { recursive: true });
  const file = resolve(prizesDir, `season-${seasonId}.json`);
  const published = {
    seasonId,
    root: toHex(tree.root),
    fundedLamports: season.fundedLamports.toString(),
    prizesLamports: prizesLamports.toString(),
    signature,
    publishedAt: Math.floor(Date.now() / 1000),
    rows: rows.map((row) => ({ ...row, amountLamports: row.amountLamports.toString() })),
  };
  writeFileSync(file, `${JSON.stringify(published, null, 2)}\n`);
  done(`wrote ${file}`);
  state = await readState();
  step('State');
  printState(state, await now());
}

if (command === 'rollover') {
  step(`Roll season ${seasonId} over`);
  const signature = await send(await rolloverSeasonInstruction({ programId, caller: signer.publicKey.toString(), seasonId }));
  done(`rolled over (${signature})`);
  state = await readState();
  step('State');
  printState(state, await now());
}
