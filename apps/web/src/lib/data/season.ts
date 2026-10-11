import type { BracketPool } from './types';

/**
 * Season payout rules from PRIZE_POOL_MODEL §7.1. The minimum-prize cap is
 * left out because the preview has no configured minimum prize yet.
 */

/** A bracket with fewer valid entries pays nothing and rolls over. */
export const MIN_VALID_ENTRIES = 5;

const WINNER_SHARE_OF_ENTRIES_BPS = 2000;

export function actualWinners(pool: BracketPool): number {
  if (pool.validEntries < MIN_VALID_ENTRIES) return 0;
  return Math.min(pool.maxWinners, Math.floor((pool.validEntries * WINNER_SHARE_OF_ENTRIES_BPS) / 10_000));
}

/** Share of the bracket pool per rank, in basis points, for `winners` cash winners. */
export function payoutSplitBps(winners: number): number[] {
  if (winners <= 0) return [];
  if (winners === 1) return [10_000];
  if (winners === 2) return [6500, 3500];
  if (winners === 3) return [5000, 3000, 2000];
  const rest = winners - 3;
  return [4000, 2500, 1500, ...Array.from({ length: rest }, () => Math.floor(2000 / rest))];
}

export function bracketPoolLamports(fundedLamports: bigint, pool: BracketPool): bigint {
  return (fundedLamports * BigInt(pool.shareBps)) / 10_000n;
}

/** Prize of each paid rank in this bracket, rank 1 first. */
export function prizesLamports(fundedLamports: bigint, pool: BracketPool): bigint[] {
  const total = bracketPoolLamports(fundedLamports, pool);
  return payoutSplitBps(actualWinners(pool)).map((bps) => (total * BigInt(bps)) / 10_000n);
}
