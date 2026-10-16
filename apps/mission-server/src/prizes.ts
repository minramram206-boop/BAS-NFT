import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPrizeTree, toHex, type PrizePool, type PrizeRow } from '@bas/chain-client';
import type { Address } from '@solana/kit';

/**
 * The winners a season published, as `scripts/devnet/prize-finalize.mjs`
 * wrote them next to the `finalize_winners` transaction. The web app builds
 * each winner's proof from these rows and claims only when their root is
 * the one on chain, so this file can be wrong but never pay the wrong wallet.
 */
export interface PublishedPrizes {
  readonly seasonId: number;
  /** Hex of the root sent to `finalize_winners`. */
  readonly root: string;
  /** Lamports funded for the season when the list was drawn up, as a decimal string. */
  readonly fundedLamports: string;
  readonly prizesLamports: string;
  readonly signature: string | null;
  readonly publishedAt: number;
  readonly rows: readonly PublishedRow[];
}

export interface PublishedRow {
  readonly index: number;
  readonly winner: string;
  /** Decimal string; JSON has no u64. */
  readonly amountLamports: string;
  readonly asset: string;
  readonly pool: PrizePool;
  readonly rank: number;
}

const POOLS: readonly string[] = ['open', 'rookie', 'skilled', 'elite', 'master'];

export function prizesFile(dir: string, seasonId: number): string {
  return join(dir, `season-${seasonId}.json`);
}

/** The rows in the shape `@bas/chain-client` builds the tree from. */
export function rowsOf(published: PublishedPrizes): PrizeRow[] {
  return published.rows.map((row) => ({
    index: row.index,
    winner: row.winner as Address,
    amountLamports: BigInt(row.amountLamports),
    asset: row.asset,
    pool: row.pool,
    rank: row.rank,
  }));
}

function isRow(value: unknown, index: number): value is PublishedRow {
  const row = value as Record<string, unknown>;
  return (
    typeof row === 'object' &&
    row !== null &&
    row.index === index &&
    typeof row.winner === 'string' &&
    typeof row.amountLamports === 'string' &&
    /^\d+$/.test(row.amountLamports) &&
    typeof row.asset === 'string' &&
    typeof row.pool === 'string' &&
    POOLS.includes(row.pool) &&
    typeof row.rank === 'number'
  );
}

/** Reads and checks a published list: well formed, and its rows hash to its root. */
export async function readPublishedPrizes(dir: string, seasonId: number): Promise<PublishedPrizes | null> {
  let raw: string;
  try {
    raw = await readFile(prizesFile(dir, seasonId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(raw) as PublishedPrizes;
  const rows = Array.isArray(value.rows) ? value.rows : [];
  if (value.seasonId !== seasonId || rows.length === 0 || !rows.every((row, index) => isRow(row, index))) {
    throw new Error(`[mission-server] ${prizesFile(dir, seasonId)} is not a published winners list`);
  }
  const tree = await buildPrizeTree(seasonId, rowsOf(value));
  if (toHex(tree.root) !== value.root) {
    throw new Error(`[mission-server] the rows in ${prizesFile(dir, seasonId)} do not hash to its root`);
  }
  return value;
}

/** Published lists by season, read once each and again when the file changes its root. */
export class PrizeBook {
  private readonly cache = new Map<number, { at: number; value: PublishedPrizes | null }>();

  constructor(
    private readonly dir: string,
    private readonly clock: () => number = Date.now,
    /** How long a read is reused, so a list published while the server runs shows up soon. */
    private readonly ttlMs = 30_000,
  ) {}

  async published(seasonId: number): Promise<PublishedPrizes | null> {
    const cached = this.cache.get(seasonId);
    if (cached && this.clock() - cached.at < this.ttlMs) return cached.value;
    const value = await readPublishedPrizes(this.dir, seasonId);
    this.cache.set(seasonId, { at: this.clock(), value });
    return value;
  }
}
