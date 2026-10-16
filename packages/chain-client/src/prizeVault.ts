import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ID } from './instructions.js';
import { programDataAddress } from './marketAdmin.js';

/**
 * Client for the season prize vault (`programs/prize_vault`,
 * docs/PRIZE_VAULT.md, D-0019): its addresses, accounts and instructions,
 * the payout rules that turn a season's standings into prizes, and the
 * winners tree whose root `finalize_winners` publishes.
 *
 * Layouts, seeds and the leaf format mirror the Rust sources;
 * `test/prize-vault.test.ts` reads those files and fails when they drift, and
 * checks the tree against a vector the program's own tests assert.
 */

const text = new TextEncoder();
const addressBytes = getAddressEncoder();
const addressDecoder = getAddressDecoder();

/** PDA seeds from `programs/prize_vault/src/constants.rs`. */
export const PRIZE_SEEDS = {
  config: 'prize-config',
  vault: 'prize-vault',
  season: 'season',
} as const;

/** `MAX_WINNERS`, `MAX_PRIZE_BPS` and `MAX_PROOF_LEN` in `constants.rs`. */
export const PRIZE_MAX_WINNERS = 35;
export const PRIZE_MAX_PRIZE_BPS = 3_000;
export const PRIZE_MAX_PROOF_LENGTH = 8;

/** How long the windows after a season last, and how fast a deployed vault runs them. */
export interface PrizeClock {
  /** Seconds that one hour of the prize windows lasts (`HOUR_SECONDS`). */
  readonly hourSeconds: number;
  /** From publishing the winners to the first claim (`DISPUTE_HOURS`). */
  readonly disputeHours: number;
}

/** The real clock, and the fast one of a vault built with `devnet-clock`; the manifest's `prizeClock` names it. */
export const PRIZE_CLOCKS = {
  real: { hourSeconds: 3_600, disputeHours: 48 },
  'devnet-fast': { hourSeconds: 10, disputeHours: 48 },
} as const satisfies Record<string, PrizeClock>;

export function prizeClockOf(name: 'devnet-fast' | undefined): PrizeClock {
  return name === undefined ? PRIZE_CLOCKS.real : PRIZE_CLOCKS[name];
}

/** Anchor discriminators: the first 8 bytes of `sha256("global:<instruction>")`. */
export const PRIZE_INSTRUCTION_DISCRIMINATORS = {
  initialize: Uint8Array.of(175, 175, 109, 31, 13, 152, 155, 237),
  fundSeason: Uint8Array.of(251, 186, 193, 242, 15, 144, 254, 67),
  finalizeWinners: Uint8Array.of(186, 149, 55, 182, 106, 221, 127, 126),
  claim: Uint8Array.of(62, 198, 214, 193, 213, 159, 108, 210),
  rollover: Uint8Array.of(147, 98, 248, 23, 82, 182, 25, 134),
  proposeAuthority: Uint8Array.of(20, 148, 236, 198, 76, 119, 99, 142),
  acceptAuthority: Uint8Array.of(107, 86, 198, 91, 33, 12, 107, 160),
} as const;

/** First 8 bytes of `sha256("account:<name>")`. */
export const PRIZE_CONFIG_DISCRIMINATOR = Uint8Array.of(148, 102, 3, 3, 90, 112, 212, 191);
export const PRIZE_VAULT_DISCRIMINATOR = Uint8Array.of(34, 226, 195, 160, 248, 75, 50, 7);
export const SEASON_DISCRIMINATOR = Uint8Array.of(76, 67, 93, 156, 180, 157, 248, 47);

/** Byte offsets of `PrizeConfig` (`programs/prize_vault/src/state/config.rs`). */
export const PRIZE_CONFIG_LAYOUT = {
  versionOffset: 8,
  authorityOffset: 9,
  pendingAuthorityOffset: 41,
  reservedOffset: 73,
  paidOffset: 81,
  bumpOffset: 89,
  vaultBumpOffset: 90,
  length: 91,
} as const;

/** `PrizeVault` is 10 bytes: discriminator, version, bump. */
export const PRIZE_VAULT_LENGTH = 10;

/** Byte offsets of `Season` (`programs/prize_vault/src/state/season.rs`). */
export const SEASON_LAYOUT = {
  versionOffset: 8,
  seasonIdOffset: 9,
  fundedOffset: 13,
  endsAtOffset: 21,
  rootOffset: 29,
  winnersOffset: 61,
  prizesOffset: 62,
  finalizedAtOffset: 70,
  claimsOpenAtOffset: 78,
  claimedOffset: 86,
  claimedBitmapOffset: 94,
  leftoverReleasedOffset: 102,
  bumpOffset: 103,
  length: 104,
} as const;

/** `PrizeError` in declaration order; Anchor numbers them from 6000. */
export const PRIZE_ERRORS = [
  'Unauthorized',
  'InvalidAmount',
  'NotEnoughUnallocated',
  'InvalidSeasonEnd',
  'SeasonEndChanged',
  'SeasonEnded',
  'SeasonNotEnded',
  'ClaimsAlreadyOpen',
  'InvalidWinnerCount',
  'PrizesOverFunding',
  'NotFinalized',
  'ClaimsNotOpen',
  'InvalidIndex',
  'InvalidProof',
  'AlreadyClaimed',
  'PrizeTooLarge',
  'ClaimsOverPrizes',
  'RolloverNotReady',
  'AlreadyRolledOver',
  'NoPendingAuthority',
  'ProofTooLong',
  'MathOverflow',
] as const;

export type PrizeErrorName = (typeof PRIZE_ERRORS)[number];

export function prizeErrorName(code: number): PrizeErrorName | undefined {
  return PRIZE_ERRORS[code - 6000];
}

// --- accounts ------------------------------------------------------------------

export interface PrizeConfigOnChain {
  version: number;
  authority: Address;
  /** `null` when no authority change is pending. */
  pendingAuthority: Address | null;
  reservedLamports: bigint;
  paidLamports: bigint;
  bump: number;
  vaultBump: number;
}

export interface SeasonOnChain {
  version: number;
  seasonId: number;
  fundedLamports: bigint;
  /** Unix seconds. */
  endsAt: number;
  winnersRoot: Uint8Array;
  winners: number;
  prizesLamports: bigint;
  /** 0 until the winners are published. */
  finalizedAt: number;
  claimsOpenAt: number;
  claimedLamports: bigint;
  claimedBitmap: bigint;
  /** The funding no winner holds went back to the pool; the prizes stay. */
  leftoverReleased: boolean;
  bump: number;
}

const DEFAULT_ADDRESS = '11111111111111111111111111111111';

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  return data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte);
}

const key = (data: Uint8Array, offset: number): Address => addressDecoder.decode(data.subarray(offset, offset + 32));

export function decodePrizeConfig(data: Uint8Array): PrizeConfigOnChain | undefined {
  const layout = PRIZE_CONFIG_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, PRIZE_CONFIG_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  const pending = key(data, layout.pendingAuthorityOffset);
  return {
    version: bytes.getUint8(layout.versionOffset),
    authority: key(data, layout.authorityOffset),
    pendingAuthority: pending === DEFAULT_ADDRESS ? null : pending,
    reservedLamports: bytes.getBigUint64(layout.reservedOffset, true),
    paidLamports: bytes.getBigUint64(layout.paidOffset, true),
    bump: bytes.getUint8(layout.bumpOffset),
    vaultBump: bytes.getUint8(layout.vaultBumpOffset),
  };
}

export function decodeSeason(data: Uint8Array): SeasonOnChain | undefined {
  const layout = SEASON_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, SEASON_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  return {
    version: bytes.getUint8(layout.versionOffset),
    seasonId: bytes.getUint32(layout.seasonIdOffset, true),
    fundedLamports: bytes.getBigUint64(layout.fundedOffset, true),
    endsAt: Number(bytes.getBigInt64(layout.endsAtOffset, true)),
    winnersRoot: data.slice(layout.rootOffset, layout.rootOffset + 32),
    winners: bytes.getUint8(layout.winnersOffset),
    prizesLamports: bytes.getBigUint64(layout.prizesOffset, true),
    finalizedAt: Number(bytes.getBigInt64(layout.finalizedAtOffset, true)),
    claimsOpenAt: Number(bytes.getBigInt64(layout.claimsOpenAtOffset, true)),
    claimedLamports: bytes.getBigUint64(layout.claimedOffset, true),
    claimedBitmap: bytes.getBigUint64(layout.claimedBitmapOffset, true),
    leftoverReleased: bytes.getUint8(layout.leftoverReleasedOffset) !== 0,
    bump: bytes.getUint8(layout.bumpOffset),
  };
}

export function hasClaimed(season: SeasonOnChain, index: number): boolean {
  return (season.claimedBitmap & (1n << BigInt(index))) !== 0n;
}

/**
 * Where a season stands, as the Season screen tells it. Claims never close
 * (D-0102): a season stays `claiming` until every prize is paid, then it is
 * `settled`, which a season without winners is as soon as claims open.
 */
export type SeasonPrizeStage = 'unfunded' | 'running' | 'counting' | 'disputing' | 'claiming' | 'settled';

export function seasonPrizeStage(season: SeasonOnChain | undefined, nowSeconds: number): SeasonPrizeStage {
  if (!season || season.fundedLamports === 0n) return 'unfunded';
  if (nowSeconds < season.endsAt) return 'running';
  if (season.finalizedAt === 0) return 'counting';
  if (nowSeconds < season.claimsOpenAt) return 'disputing';
  return season.claimedLamports >= season.prizesLamports ? 'settled' : 'claiming';
}

/**
 * SOL in the vault that no season holds: the balance less the vault's rent
 * and the funding seasons still owe.
 */
export function unallocatedLamports(vaultLamports: bigint, vaultRentLamports: bigint, config: PrizeConfigOnChain): bigint {
  const free = vaultLamports - vaultRentLamports - config.reservedLamports;
  return free > 0n ? free : 0n;
}

// --- addresses -------------------------------------------------------------------

async function derive(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress, seeds });
  return pda;
}

function u32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function i64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

export const prizeConfigAddress = (programId: Address): Promise<Address> =>
  derive(programId, [text.encode(PRIZE_SEEDS.config)]);

export const prizeVaultAddress = (programId: Address): Promise<Address> =>
  derive(programId, [text.encode(PRIZE_SEEDS.vault)]);

export const seasonAddress = (programId: Address, seasonId: number): Promise<Address> =>
  derive(programId, [text.encode(PRIZE_SEEDS.season), u32Le(seasonId)]);

// --- instructions ------------------------------------------------------------------

export async function initializePrizeVaultInstruction(input: { programId: Address; authority: Address }): Promise<Instruction> {
  const { programId, authority } = input;
  const [config, vault, programData] = await Promise.all([
    prizeConfigAddress(programId),
    prizeVaultAddress(programId),
    programDataAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: programData, role: AccountRole.READONLY },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from(PRIZE_INSTRUCTION_DISCRIMINATORS.initialize),
  };
}

export interface FundSeasonInput {
  programId: Address;
  authority: Address;
  seasonId: number;
  amountLamports: bigint;
  /** Unix seconds; the same value on every call for one season. */
  endsAt: number;
}

export async function fundSeasonInstruction(input: FundSeasonInput): Promise<Instruction> {
  const { programId, authority, seasonId, amountLamports, endsAt } = input;
  const [config, vault, season] = await Promise.all([
    prizeConfigAddress(programId),
    prizeVaultAddress(programId),
    seasonAddress(programId, seasonId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.READONLY },
      { address: season, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([
      ...PRIZE_INSTRUCTION_DISCRIMINATORS.fundSeason,
      ...u32Le(seasonId),
      ...u64Le(amountLamports),
      ...i64Le(BigInt(endsAt)),
    ]),
  };
}

export interface FinalizeWinnersInput {
  programId: Address;
  authority: Address;
  seasonId: number;
  winnersRoot: Uint8Array;
  winners: number;
  prizesLamports: bigint;
}

export async function finalizeWinnersInstruction(input: FinalizeWinnersInput): Promise<Instruction> {
  const { programId, authority, seasonId, winnersRoot, winners, prizesLamports } = input;
  if (winnersRoot.length !== 32) throw new RangeError('the winners root is 32 bytes');
  const [config, season] = await Promise.all([prizeConfigAddress(programId), seasonAddress(programId, seasonId)]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: season, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from([
      ...PRIZE_INSTRUCTION_DISCRIMINATORS.finalizeWinners,
      ...u32Le(seasonId),
      ...winnersRoot,
      winners,
      ...u64Le(prizesLamports),
    ]),
  };
}

export interface ClaimPrizeInput {
  programId: Address;
  winner: Address;
  seasonId: number;
  index: number;
  amountLamports: bigint;
  proof: readonly Uint8Array[];
}

export async function claimPrizeInstruction(input: ClaimPrizeInput): Promise<Instruction> {
  const { programId, winner, seasonId, index, amountLamports, proof } = input;
  if (proof.length > PRIZE_MAX_PROOF_LENGTH) throw new RangeError('the proof is too long');
  const [config, vault, season] = await Promise.all([
    prizeConfigAddress(programId),
    prizeVaultAddress(programId),
    seasonAddress(programId, seasonId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: season, role: AccountRole.WRITABLE },
      { address: winner, role: AccountRole.WRITABLE_SIGNER },
    ],
    data: Uint8Array.from([
      ...PRIZE_INSTRUCTION_DISCRIMINATORS.claim,
      ...u32Le(seasonId),
      index,
      ...u64Le(amountLamports),
      ...u32Le(proof.length),
      ...proof.flatMap((hash) => [...hash]),
    ]),
  };
}

export async function rolloverSeasonInstruction(input: { programId: Address; caller: Address; seasonId: number }): Promise<Instruction> {
  const { programId, caller, seasonId } = input;
  const [config, season] = await Promise.all([prizeConfigAddress(programId), seasonAddress(programId, seasonId)]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: season, role: AccountRole.WRITABLE },
      { address: caller, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from([...PRIZE_INSTRUCTION_DISCRIMINATORS.rollover, ...u32Le(seasonId)]),
  };
}

export async function proposePrizeAuthorityInstruction(input: {
  programId: Address;
  authority: Address;
  proposed: Address;
}): Promise<Instruction> {
  const { programId, authority, proposed } = input;
  return {
    programAddress: programId,
    accounts: [
      { address: await prizeConfigAddress(programId), role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from([...PRIZE_INSTRUCTION_DISCRIMINATORS.proposeAuthority, ...addressBytes.encode(proposed)]),
  };
}

export async function acceptPrizeAuthorityInstruction(input: { programId: Address; pendingAuthority: Address }): Promise<Instruction> {
  const { programId, pendingAuthority } = input;
  return {
    programAddress: programId,
    accounts: [
      { address: await prizeConfigAddress(programId), role: AccountRole.WRITABLE },
      { address: pendingAuthority, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from(PRIZE_INSTRUCTION_DISCRIMINATORS.acceptAuthority),
  };
}

// --- payout rules ------------------------------------------------------------------

export type PrizePool = 'open' | 'rookie' | 'skilled' | 'elite' | 'master';
export type PrizeBracket = Exclude<PrizePool, 'open'>;

export interface PrizePoolRule {
  readonly id: PrizePool;
  /** Share of the season's funding in basis points. */
  readonly shareBps: number;
  /** Most ranks this pool pays. */
  readonly maxWinners: number;
}

/** PRIZE_POOL_MODEL §7 and §7.1, in the order rows are numbered in the winners tree. */
export const PRIZE_POOLS: readonly PrizePoolRule[] = [
  { id: 'open', shareBps: 3000, maxWinners: 10 },
  { id: 'rookie', shareBps: 1000, maxWinners: 10 },
  { id: 'skilled', shareBps: 1500, maxWinners: 7 },
  { id: 'elite', shareBps: 2000, maxWinners: 5 },
  { id: 'master', shareBps: 2500, maxWinners: 3 },
];

/** A pool with fewer valid entries pays nothing; its share rolls over. */
export const MIN_VALID_ENTRIES = 5;
const WINNER_SHARE_OF_ENTRIES_BPS = 2000;

/** Ranks a pool pays: at most its cap, and one for every five valid entries. */
export function actualWinners(pool: { maxWinners: number; validEntries: number }): number {
  if (pool.validEntries < MIN_VALID_ENTRIES) return 0;
  return Math.min(pool.maxWinners, Math.floor((pool.validEntries * WINNER_SHARE_OF_ENTRIES_BPS) / 10_000));
}

/** Share of the pool per rank, in basis points, for `winners` cash winners (§7.1). */
export function payoutSplitBps(winners: number): number[] {
  if (winners <= 0) return [];
  if (winners === 1) return [10_000];
  if (winners === 2) return [6500, 3500];
  if (winners === 3) return [5000, 3000, 2000];
  const rest = winners - 3;
  return [4000, 2500, 1500, ...Array.from({ length: rest }, () => Math.floor(2000 / rest))];
}

export function poolLamports(fundedLamports: bigint, pool: { shareBps: number }): bigint {
  return (fundedLamports * BigInt(pool.shareBps)) / 10_000n;
}

/** Prize of each paid rank in a pool, rank 1 first. */
export function poolPrizesLamports(fundedLamports: bigint, pool: { shareBps: number; maxWinners: number; validEntries: number }): bigint[] {
  const total = poolLamports(fundedLamports, pool);
  return payoutSplitBps(actualWinners(pool)).map((bps) => (total * BigInt(bps)) / 10_000n);
}

/** The bracket of a citizen from its highest stat (§6; the Master achievements are not checked yet). */
export function bracketOfStats(stats: { intelligence: number; alignment: number; compute: number }): PrizeBracket {
  const highest = Math.max(stats.intelligence, stats.alignment, stats.compute);
  if (highest >= 10) return 'master';
  if (highest >= 7) return 'elite';
  if (highest >= 4) return 'skilled';
  return 'rookie';
}

/** One citizen in the season's standings, with who holds it when the winners are drawn up. */
export interface PrizeEntry {
  readonly asset: string;
  readonly owner: Address;
  readonly points: number;
  readonly bracket: PrizeBracket;
}

/** One prize: a leaf of the winners tree. */
export interface PrizeRow {
  readonly index: number;
  readonly winner: Address;
  readonly amountLamports: bigint;
  readonly asset: string;
  readonly pool: PrizePool;
  /** 1 for first place in its pool. */
  readonly rank: number;
}

/**
 * The prizes of a season from its standings: every citizen competes in the
 * open pool and in its own bracket, each pool ranked by points (ties by
 * asset address, as the mission server sorts them). The owner at the time of
 * drawing up is paid. Rows are numbered pool by pool in `PRIZE_POOLS` order.
 */
export function seasonPrizeRows(fundedLamports: bigint, entries: readonly PrizeEntry[]): PrizeRow[] {
  const ranked = [...entries].sort((a, b) => b.points - a.points || a.asset.localeCompare(b.asset));
  const rows: PrizeRow[] = [];
  for (const pool of PRIZE_POOLS) {
    const field = ranked.filter((entry) => entry.points > 0 && (pool.id === 'open' || entry.bracket === pool.id));
    const prizes = poolPrizesLamports(fundedLamports, { ...pool, validEntries: field.length });
    prizes.forEach((amountLamports, place) => {
      const entry = field[place];
      if (!entry || amountLamports === 0n) return;
      rows.push({ index: rows.length, winner: entry.owner, amountLamports, asset: entry.asset, pool: pool.id, rank: place + 1 });
    });
  }
  return rows;
}

// --- winners tree -------------------------------------------------------------------

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', joined));
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** `merkle::leaf` in the program. */
export function prizeLeaf(seasonId: number, index: number, winner: Address, amountLamports: bigint): Promise<Uint8Array> {
  return sha256(Uint8Array.of(0), u32Le(seasonId), Uint8Array.of(index), new Uint8Array(addressBytes.encode(winner)), u64Le(amountLamports));
}

/** `merkle::node`: the pair sorted, so a proof needs no left or right. */
export function prizeNode(a: Uint8Array, b: Uint8Array): Promise<Uint8Array> {
  return compare(a, b) <= 0 ? sha256(Uint8Array.of(1), a, b) : sha256(Uint8Array.of(1), b, a);
}

export interface PrizeTree {
  readonly root: Uint8Array;
  /** Proof of each row, by index. */
  readonly proofs: readonly Uint8Array[][];
}

/** The tree of a season's rows; an odd hash at the end of a level moves up unchanged. */
export async function buildPrizeTree(seasonId: number, rows: readonly PrizeRow[]): Promise<PrizeTree> {
  if (rows.length === 0 || rows.length > PRIZE_MAX_WINNERS) throw new RangeError(`a season pays 1 to ${PRIZE_MAX_WINNERS} winners`);
  rows.forEach((row, index) => {
    if (row.index !== index) throw new RangeError('rows must be numbered 0, 1, 2, ... in order');
  });
  let level = await Promise.all(rows.map((row) => prizeLeaf(seasonId, row.index, row.winner, row.amountLamports)));
  const proofs: Uint8Array[][] = rows.map(() => []);
  const positions = rows.map((_, index) => index);
  while (level.length > 1) {
    positions.forEach((position, row) => {
      const sibling = level[position ^ 1];
      if (sibling) proofs[row]?.push(sibling);
      positions[row] = position >> 1;
    });
    const next: Promise<Uint8Array>[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Uint8Array;
      const right = level[i + 1];
      next.push(right ? prizeNode(left, right) : Promise.resolve(left));
    }
    level = await Promise.all(next);
  }
  return { root: level[0] as Uint8Array, proofs };
}

export async function verifyPrizeProof(root: Uint8Array, leaf: Uint8Array, proof: readonly Uint8Array[]): Promise<boolean> {
  let hash = leaf;
  for (const sibling of proof) hash = await prizeNode(hash, sibling);
  return compare(hash, root) === 0 && hash.length === root.length;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new RangeError('not a hex string');
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}
