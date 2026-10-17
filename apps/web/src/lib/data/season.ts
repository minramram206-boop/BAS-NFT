import {
  MIN_PRIZE_LAMPORTS,
  MIN_VALID_ENTRIES,
  PRIZE_POOLS,
  actualWinners,
  payoutSplitBps,
  poolField,
  poolLamports,
  poolPrizesLamports,
} from '@bas/chain-client/browser';
import type { BracketPool } from './types';

/**
 * Season payout rules from PRIZE_POOL_MODEL §7.1. They live in
 * `@bas/chain-client`, where the mission server draws up the winners tree
 * with the same code, so the board shows what the vault will pay.
 */

export { MIN_PRIZE_LAMPORTS, MIN_VALID_ENTRIES, actualWinners, payoutSplitBps, poolField };

export function bracketPoolLamports(fundedLamports: bigint, pool: BracketPool): bigint {
  return poolLamports(fundedLamports, pool);
}

/** Prize of each paid rank in this bracket, rank 1 first. */
export function prizesLamports(fundedLamports: bigint, pool: BracketPool): bigint[] {
  return poolPrizesLamports(fundedLamports, pool);
}

/** Pools of a season: each bracket's share of the prize and how many ranks it can pay (PRIZE_POOL_MODEL §6). */
export const POOL_RULES: readonly Pick<BracketPool, 'id' | 'shareBps' | 'maxWinners'>[] = PRIZE_POOLS;
