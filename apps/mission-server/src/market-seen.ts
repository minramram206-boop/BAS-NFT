import type { createPool } from '@bas/chat-store';

type Pool = ReturnType<typeof createPool>;

/** Most notice ids kept per wallet; the web app remembers no more than this either. */
export const SEEN_NOTICES_LIMIT = 200;

/**
 * The market notices each wallet has dismissed (D-0096). A notice id names a
 * sale or a bid that is public on chain anyway, so reading the list needs no
 * sign-in; adding to it does, so nobody can hide another wallet's notices.
 */
export interface SeenStore {
  /** Newest first, at most {@link SEEN_NOTICES_LIMIT}. */
  list(wallet: string): Promise<string[]>;
  add(wallet: string, ids: readonly string[], at: number): Promise<void>;
}

/** Kept in this process only, for a server without `DATABASE_URL`. */
export class MemorySeenStore implements SeenStore {
  private readonly byWallet = new Map<string, string[]>();

  async list(wallet: string): Promise<string[]> {
    return [...(this.byWallet.get(wallet) ?? [])];
  }

  async add(wallet: string, ids: readonly string[]): Promise<void> {
    const kept = this.byWallet.get(wallet) ?? [];
    const fresh = ids.filter((id, index) => !kept.includes(id) && ids.indexOf(id) === index);
    this.byWallet.set(wallet, [...fresh, ...kept].slice(0, SEEN_NOTICES_LIMIT));
  }
}

/** In Postgres, table `market_seen` of migration `0003-market-seen`. */
export class PgSeenStore implements SeenStore {
  constructor(private readonly pool: Pool) {}

  async list(wallet: string): Promise<string[]> {
    const result = await this.pool.query<{ notice_id: string }>(
      'SELECT notice_id FROM market_seen WHERE wallet = $1 ORDER BY seen_at DESC, notice_id LIMIT $2',
      [wallet, SEEN_NOTICES_LIMIT],
    );
    return result.rows.map((row) => row.notice_id);
  }

  async add(wallet: string, ids: readonly string[], at: number): Promise<void> {
    if (ids.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO market_seen (wallet, notice_id, seen_at)
         SELECT $1, id, $3 FROM unnest($2::text[]) AS id
         ON CONFLICT (wallet, notice_id) DO NOTHING`,
        [wallet, ids, at],
      );
      await client.query(
        `DELETE FROM market_seen WHERE wallet = $1 AND notice_id NOT IN (
           SELECT notice_id FROM market_seen WHERE wallet = $1 ORDER BY seen_at DESC, notice_id LIMIT $2
         )`,
        [wallet, SEEN_NOTICES_LIMIT],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
