import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import { AccountRole, getAddressDecoder, type Address } from '@solana/kit';
import {
  MIN_PRIZE_LAMPORTS,
  PRIZE_CLOCKS,
  PRIZE_CONFIG_DISCRIMINATOR,
  PRIZE_CONFIG_LAYOUT,
  PRIZE_ERRORS,
  PRIZE_INSTRUCTION_DISCRIMINATORS,
  PRIZE_MAX_PRIZE_BPS,
  PRIZE_MAX_PROOF_LENGTH,
  PRIZE_MAX_WINNERS,
  PRIZE_POOLS,
  PRIZE_SEEDS,
  PRIZE_VAULT_DISCRIMINATOR,
  PRIZE_VAULT_LENGTH,
  SEASON_DISCRIMINATOR,
  SEASON_LAYOUT,
  bracketOfStats,
  buildPrizeTree,
  claimPrizeInstruction,
  decodePrizeConfig,
  decodeSeason,
  finalizeWinnersInstruction,
  fundSeasonInstruction,
  hasClaimed,
  initializePrizeVaultInstruction,
  isMasterEligible,
  prizeLeaf,
  rolloverSeasonInstruction,
  seasonPrizeRows,
  seasonPrizeStage,
  toHex,
  unallocatedLamports,
  verifyPrizeProof,
  type PrizeEntry,
  type PrizeRow,
} from '../dist/index.js';

const PROGRAM = '5A2vzRDhfPfzpZrtvmhx6HFLLD2xmdcHStDwzPcNuXUP' as Address;
const source = (file: string): string => readFileSync(join(findRepoRoot(), 'programs/prize_vault/src', file), 'utf8');
const anchor = (prefix: string, name: string) => Uint8Array.from(createHash('sha256').update(`${prefix}:${name}`).digest().subarray(0, 8));
const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const decoder = getAddressDecoder();
const addressOf = (byte: number): Address => decoder.decode(new Uint8Array(32).fill(byte));

const SIZES: Record<string, number> = { u8: 1, bool: 1, u32: 4, u64: 8, i64: 8, Pubkey: 32, '[u8; 32]': 32 };

/** Byte offset of each field of an `#[account]` struct, after the 8 byte discriminator. */
function layoutOf(file: string, struct: string): { offsets: Record<string, number>; length: number } {
  const body = new RegExp(`pub struct ${struct} \\{([\\s\\S]*?)\\n\\}`).exec(source(file))?.[1];
  assert.ok(body, `${struct} not found in ${file}`);
  const offsets: Record<string, number> = {};
  let offset = 8;
  for (const [, name, type] of body.matchAll(/pub (\w+): ([^,]+),/g)) {
    const size = SIZES[(type as string).trim()];
    assert.ok(size, `unknown size of ${type}`);
    offsets[name as string] = offset;
    offset += size;
  }
  return { offsets, length: offset };
}

/** Account names of a `#[derive(Accounts)]` struct, in order. */
function accountsOf(file: string, struct: string): string[] {
  const body = new RegExp(`pub struct ${struct}<'info> \\{([\\s\\S]*?)\\n\\}`).exec(source(file))?.[1];
  assert.ok(body, `${struct} not found in ${file}`);
  return [...body.matchAll(/pub (\w+):/g)].map((match) => match[1] as string);
}

function constant(name: string): string {
  const match = new RegExp(`pub const ${name}: [^=]+= ([^;]+);`).exec(source('constants.rs'));
  assert.ok(match, `${name} not in constants.rs`);
  return (match[1] as string).trim();
}

describe('prize vault client against the Rust sources', () => {
  it('uses the same seeds and limits', () => {
    assert.equal(constant('CONFIG_SEED'), `b"${PRIZE_SEEDS.config}"`);
    assert.equal(constant('VAULT_SEED'), `b"${PRIZE_SEEDS.vault}"`);
    assert.equal(constant('SEASON_SEED'), `b"${PRIZE_SEEDS.season}"`);
    assert.equal(Number(constant('MAX_WINNERS')), PRIZE_MAX_WINNERS);
    assert.equal(Number(constant('MAX_PRIZE_BPS').replace('_', '')), PRIZE_MAX_PRIZE_BPS);
    assert.equal(Number(constant('MAX_PROOF_LEN')), PRIZE_MAX_PROOF_LENGTH);
    assert.equal(Number(constant('DISPUTE_HOURS')), PRIZE_CLOCKS.real.disputeHours);
    assert.doesNotMatch(source('constants.rs'), /CLAIM_HOURS/, 'prizes have no claim deadline (D-0102)');
    const hours = [...source('constants.rs').matchAll(/pub const HOUR_SECONDS: i64 = ([\d_]+);/g)].map((m) => Number((m[1] as string).replace('_', '')));
    assert.deepEqual(hours, [PRIZE_CLOCKS.real.hourSeconds, PRIZE_CLOCKS['devnet-fast'].hourSeconds]);
  });

  it('uses the Anchor discriminators', () => {
    for (const [name, bytes] of Object.entries(PRIZE_INSTRUCTION_DISCRIMINATORS)) {
      assert.deepEqual(bytes, anchor('global', snake(name)), name);
    }
    assert.deepEqual(PRIZE_CONFIG_DISCRIMINATOR, anchor('account', 'PrizeConfig'));
    assert.deepEqual(PRIZE_VAULT_DISCRIMINATOR, anchor('account', 'PrizeVault'));
    assert.deepEqual(SEASON_DISCRIMINATOR, anchor('account', 'Season'));
  });

  it('reads the accounts at the program offsets', () => {
    const config = layoutOf('state/config.rs', 'PrizeConfig');
    assert.deepEqual(
      [config.offsets.version, config.offsets.authority, config.offsets.pending_authority, config.offsets.reserved_lamports, config.offsets.paid_lamports, config.offsets.bump, config.offsets.vault_bump, config.length],
      [PRIZE_CONFIG_LAYOUT.versionOffset, PRIZE_CONFIG_LAYOUT.authorityOffset, PRIZE_CONFIG_LAYOUT.pendingAuthorityOffset, PRIZE_CONFIG_LAYOUT.reservedOffset, PRIZE_CONFIG_LAYOUT.paidOffset, PRIZE_CONFIG_LAYOUT.bumpOffset, PRIZE_CONFIG_LAYOUT.vaultBumpOffset, PRIZE_CONFIG_LAYOUT.length],
    );
    assert.equal(layoutOf('state/vault.rs', 'PrizeVault').length, PRIZE_VAULT_LENGTH);
    const season = layoutOf('state/season.rs', 'Season');
    const expected: Record<string, number> = {
      version: SEASON_LAYOUT.versionOffset,
      season_id: SEASON_LAYOUT.seasonIdOffset,
      funded_lamports: SEASON_LAYOUT.fundedOffset,
      ends_at: SEASON_LAYOUT.endsAtOffset,
      winners_root: SEASON_LAYOUT.rootOffset,
      winners: SEASON_LAYOUT.winnersOffset,
      prizes_lamports: SEASON_LAYOUT.prizesOffset,
      finalized_at: SEASON_LAYOUT.finalizedAtOffset,
      claims_open_at: SEASON_LAYOUT.claimsOpenAtOffset,
      claimed_lamports: SEASON_LAYOUT.claimedOffset,
      claimed_bitmap: SEASON_LAYOUT.claimedBitmapOffset,
      leftover_released: SEASON_LAYOUT.leftoverReleasedOffset,
      bump: SEASON_LAYOUT.bumpOffset,
    };
    assert.deepEqual(season.offsets, expected);
    assert.equal(season.length, SEASON_LAYOUT.length);
  });

  it('names the errors in program order', () => {
    const variants = [...source('errors.rs').matchAll(/^\s{4}(\w+),$/gm)].map((match) => match[1]);
    assert.deepEqual(variants, [...PRIZE_ERRORS]);
  });

  it('lists the accounts of each instruction in program order', async () => {
    const authority = addressOf(7);
    const cases = [
      [await initializePrizeVaultInstruction({ programId: PROGRAM, authority }), 'initialize.rs', 'Initialize'],
      [await fundSeasonInstruction({ programId: PROGRAM, authority, seasonId: 1, amountLamports: 1n, endsAt: 1 }), 'fund_season.rs', 'FundSeason'],
      [await finalizeWinnersInstruction({ programId: PROGRAM, authority, seasonId: 1, winnersRoot: new Uint8Array(32), winners: 1, prizesLamports: 1n }), 'finalize_winners.rs', 'FinalizeWinners'],
      [await claimPrizeInstruction({ programId: PROGRAM, winner: authority, seasonId: 1, index: 0, amountLamports: 1n, proof: [] }), 'claim.rs', 'Claim'],
      [await rolloverSeasonInstruction({ programId: PROGRAM, caller: authority, seasonId: 1 }), 'rollover.rs', 'Rollover'],
    ] as const;
    for (const [instruction, file, struct] of cases) {
      assert.equal(instruction.accounts?.length, accountsOf(`instructions/${file}`, struct).length, struct);
    }
  });
});

describe('prize vault instructions and accounts', () => {
  it('encodes fund_season and claim as Anchor does', async () => {
    const fund = await fundSeasonInstruction({ programId: PROGRAM, authority: addressOf(7), seasonId: 3, amountLamports: 5n, endsAt: 1_800_000_000 });
    const data = fund.data as Uint8Array;
    assert.equal(data.length, 8 + 4 + 8 + 8);
    const view = new DataView(data.buffer, data.byteOffset);
    assert.deepEqual([view.getUint32(8, true), view.getBigUint64(12, true), view.getBigInt64(20, true)], [3, 5n, 1_800_000_000n]);

    const proof = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    const claim = await claimPrizeInstruction({ programId: PROGRAM, winner: addressOf(9), seasonId: 3, index: 4, amountLamports: 7n, proof });
    const bytes = claim.data as Uint8Array;
    assert.equal(bytes.length, 8 + 4 + 1 + 8 + 4 + 64);
    assert.equal(bytes[12], 4);
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(21, true), 2);
    assert.equal(claim.accounts?.[3]?.role, AccountRole.WRITABLE_SIGNER);
  });

  it('decodes a season and tells its stage', () => {
    const data = new Uint8Array(SEASON_LAYOUT.length);
    data.set(SEASON_DISCRIMINATOR);
    const view = new DataView(data.buffer);
    view.setUint8(SEASON_LAYOUT.versionOffset, 1);
    view.setUint32(SEASON_LAYOUT.seasonIdOffset, 2, true);
    view.setBigUint64(SEASON_LAYOUT.fundedOffset, 9n, true);
    view.setBigInt64(SEASON_LAYOUT.endsAtOffset, 100n, true);
    view.setUint8(SEASON_LAYOUT.winnersOffset, 3);
    view.setBigInt64(SEASON_LAYOUT.finalizedAtOffset, 110n, true);
    view.setBigInt64(SEASON_LAYOUT.claimsOpenAtOffset, 200n, true);
    view.setBigUint64(SEASON_LAYOUT.prizesOffset, 6n, true);
    view.setBigUint64(SEASON_LAYOUT.claimedOffset, 4n, true);
    view.setBigUint64(SEASON_LAYOUT.claimedBitmapOffset, 0b101n, true);
    const season = decodeSeason(data);
    assert.ok(season);
    assert.deepEqual([season.seasonId, season.fundedLamports, season.winners], [2, 9n, 3]);
    assert.deepEqual([hasClaimed(season, 0), hasClaimed(season, 1), hasClaimed(season, 2)], [true, false, true]);
    assert.deepEqual(
      [50, 150, 250, 999_999_999].map((now) => seasonPrizeStage(season, now)),
      ['running', 'disputing', 'claiming', 'claiming'],
    );
    assert.equal(seasonPrizeStage({ ...season, claimedLamports: 6n }, 250), 'settled');
    assert.equal(seasonPrizeStage({ ...season, winners: 0, prizesLamports: 0n, claimedLamports: 0n }, 250), 'settled');
    assert.equal(seasonPrizeStage({ ...season, finalizedAt: 0 }, 150), 'counting');
    assert.equal(seasonPrizeStage(undefined, 0), 'unfunded');
    assert.equal(decodeSeason(data.subarray(1)), undefined);
  });

  it('decodes the config and the unallocated balance', () => {
    const data = new Uint8Array(PRIZE_CONFIG_LAYOUT.length);
    data.set(PRIZE_CONFIG_DISCRIMINATOR);
    data.set(new Uint8Array(32).fill(5), PRIZE_CONFIG_LAYOUT.authorityOffset);
    new DataView(data.buffer).setBigUint64(PRIZE_CONFIG_LAYOUT.reservedOffset, 40n, true);
    const config = decodePrizeConfig(data);
    assert.ok(config);
    assert.equal(config.authority, addressOf(5));
    assert.equal(config.pendingAuthority, null);
    assert.equal(unallocatedLamports(100n, 10n, config), 50n);
    assert.equal(unallocatedLamports(30n, 10n, config), 0n);
  });
});

describe('winners tree', () => {
  const rowsOf = (count: number): PrizeRow[] =>
    Array.from({ length: count }, (_, index) => ({
      index,
      winner: addressOf(index + 1),
      amountLamports: 1_000n * BigInt(index + 1),
      asset: `asset-${index}`,
      pool: 'open' as const,
      rank: index + 1,
    }));

  it('matches the vector the program tests assert', async () => {
    const rows = rowsOf(5);
    const leaf = await prizeLeaf(1, 0, rows[0]!.winner, rows[0]!.amountLamports);
    assert.equal(toHex(leaf), 'a4b1f098b33cd34af364dd93f1a6bb008bc4a8f7ebc281ccf79a927133ee3367');
    const tree = await buildPrizeTree(1, rows);
    assert.equal(toHex(tree.root), 'dea079247b54a918d3c467dfc4f933f41107b5494fa9fbe0f247bab06b1b8d96');
  });

  it('proves every row for every list size, and nothing else', async () => {
    for (let count = 1; count <= PRIZE_MAX_WINNERS; count += 1) {
      const rows = rowsOf(count);
      const tree = await buildPrizeTree(7, rows);
      for (const row of rows) {
        const leaf = await prizeLeaf(7, row.index, row.winner, row.amountLamports);
        assert.ok(await verifyPrizeProof(tree.root, leaf, tree.proofs[row.index]!), `${count} rows, row ${row.index}`);
        assert.ok((tree.proofs[row.index]?.length ?? 0) <= PRIZE_MAX_PROOF_LENGTH);
      }
    }
    const rows = rowsOf(4);
    const tree = await buildPrizeTree(7, rows);
    const forged = await prizeLeaf(7, 1, rows[1]!.winner, rows[1]!.amountLamports + 1n);
    assert.equal(await verifyPrizeProof(tree.root, forged, tree.proofs[1]!), false);
    await assert.rejects(buildPrizeTree(7, []), RangeError);
  });
});

describe('season prizes', () => {
  const entry = (n: number, points: number, bracket: PrizeEntry['bracket']): PrizeEntry => ({
    asset: `asset-${String(n).padStart(2, '0')}`,
    owner: addressOf(n),
    points,
    bracket,
  });

  it('pays the pools that have enough entries, rank by rank', () => {
    // Twelve rookies and five skilled: open has 17 entries (3 winners), rookie 12 (2), skilled 5 (1).
    const entries = [
      ...Array.from({ length: 12 }, (_, i) => entry(i + 1, 100 - i, 'rookie')),
      ...Array.from({ length: 5 }, (_, i) => entry(20 + i, 50 - i, 'skilled')),
    ];
    const funded = 10_000_000_000n;
    const rows = seasonPrizeRows(funded, entries);
    assert.deepEqual(
      rows.map((row) => [row.pool, row.rank, row.asset, row.amountLamports]),
      [
        ['open', 1, 'asset-01', 1_500_000_000n],
        ['open', 2, 'asset-02', 900_000_000n],
        ['open', 3, 'asset-03', 600_000_000n],
        ['rookie', 1, 'asset-01', 650_000_000n],
        ['rookie', 2, 'asset-02', 350_000_000n],
        ['skilled', 1, 'asset-20', 1_500_000_000n],
      ],
    );
    assert.deepEqual(rows.map((row) => row.index), [0, 1, 2, 3, 4, 5]);
    // Elite and master had no entries; their 45% stays in the vault.
    const paid = rows.reduce((sum, row) => sum + row.amountLamports, 0n);
    assert.equal(paid, 5_500_000_000n);
    assert.ok(rows.every((row) => row.amountLamports * 10_000n <= funded * BigInt(PRIZE_MAX_PRIZE_BPS)));
  });

  it('never pays more than 35 rows', () => {
    const brackets = ['rookie', 'skilled', 'elite', 'master'] as const;
    const entries = Array.from({ length: 200 }, (_, i) => entry(i + 1, 1000 - i, brackets[i % 4]!));
    const rows = seasonPrizeRows(10_000_000_000n, entries);
    assert.equal(rows.length, PRIZE_POOLS.reduce((sum, pool) => sum + pool.maxWinners, 0));
    assert.equal(rows.length, PRIZE_MAX_WINNERS);
  });

  it('leaves out citizens without points', () => {
    const entries = Array.from({ length: 6 }, (_, i) => entry(i + 1, i < 5 ? 10 : 0, 'rookie'));
    assert.equal(seasonPrizeRows(1_000_000_000n, entries).filter((row) => row.pool === 'open').length, 1);
  });

  it('counts at most one citizen per wallet in each competition pool', () => {
    const whale = addressOf(99);
    // One wallet holds five rookies; alone they do not reach five valid entries.
    const solo = Array.from({ length: 5 }, (_, i) => ({
      asset: `whale-${i}`,
      owner: whale,
      points: 500 - i * 10,
      bracket: 'rookie' as const,
    }));
    assert.deepEqual(seasonPrizeRows(10_000_000_000n, solo), []);

    // Add four other wallets: now open and rookie each have 5 valid entries (1 winner), and the whale's best citizen wins.
    const others = Array.from({ length: 4 }, (_, i) => entry(i + 1, 100 - i, 'rookie'));
    const rows = seasonPrizeRows(10_000_000_000n, [...solo, ...others]);
    assert.deepEqual(
      rows.map((row) => [row.pool, row.rank, row.asset, row.winner]),
      [
        ['open', 1, 'whale-0', whale],
        ['rookie', 1, 'whale-0', whale],
      ],
    );
  });

  it('requires three seasonal claims including summitTrial for the Master bracket', () => {
    assert.equal(isMasterEligible([{ missionId: 'summitTrial' }, { missionId: 'streetLamp' }]), false);
    assert.equal(isMasterEligible([{ missionId: 'streetLamp' }, { missionId: 'lightsOut' }, { missionId: 'nightPatrol' }]), false);
    assert.equal(isMasterEligible([{ missionId: 'summitTrial' }, { missionId: 'streetLamp' }, { missionId: 'lightsOut' }]), true);
    assert.equal(bracketOfStats({ intelligence: 10, alignment: 1, compute: 1 }, false), 'elite');
    assert.equal(bracketOfStats({ intelligence: 10, alignment: 1, compute: 1 }, true), 'master');
  });

  it('caps winners by the 0.1 SOL minimum prize', () => {
    assert.equal(MIN_PRIZE_LAMPORTS, 100_000_000n);
    const entries = [
      ...Array.from({ length: 10 }, (_, i) => entry(i + 1, 200 - i, 'rookie')),
      ...Array.from({ length: 10 }, (_, i) => entry(20 + i, 100 - i, 'elite')),
    ];
    // With 0.5 SOL funded: open has 0.15 SOL (1 winner), elite has 0.10 SOL (1 winner), rookie has 0.05 SOL (0 winners, below 0.1 SOL).
    const rows = seasonPrizeRows(500_000_000n, entries);
    assert.deepEqual(
      rows.map((row) => [row.pool, row.rank, row.amountLamports]),
      [
        ['open', 1, 150_000_000n],
        ['elite', 1, 100_000_000n],
      ],
    );
  });
});
