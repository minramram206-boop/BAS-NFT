import {
  type MemoryStore,
  PUBLIC_HISTORY_LINES,
  type PrivateMemory,
  type QuotaStore,
  type SpendLedger,
} from '@bas/ai';
import pg, { type Pool, type PoolConfig } from 'pg';

export function createPool(connectionString: string, options: PoolConfig = {}): Pool {
  const pool = new pg.Pool({ connectionString, max: 10, ...options });
  // An idle connection dropped by a database restart is reported on the pool. With no
  // listener Node would treat it as an uncaught error and stop the whole service.
  pool.on('error', (error) => {
    console.error(`[chat-store] a Postgres connection was lost: ${error.message}`);
  });
  return pool;
}

/** Message count per asset per UTC day. `consume` is one statement, so two requests cannot both take the last message. */
export class PgQuotaStore implements QuotaStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async consume(asset: string, day: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    if (limit < 1) return { allowed: false, used: await this.used(asset, day) };
    const result = await this.pool.query<{ used: number }>(
      `INSERT INTO chat_quota (asset, day, used) VALUES ($1, $2, 1)
       ON CONFLICT (asset, day) DO UPDATE SET used = chat_quota.used + 1
       WHERE chat_quota.used < $3
       RETURNING used`,
      [asset, day, limit],
    );
    const row = result.rows[0];
    if (row) return { allowed: true, used: row.used };
    return { allowed: false, used: await this.used(asset, day) };
  }

  async refund(asset: string, day: string): Promise<void> {
    await this.pool.query('UPDATE chat_quota SET used = GREATEST(used - 1, 0) WHERE asset = $1 AND day = $2', [asset, day]);
  }

  async used(asset: string, day: string): Promise<number> {
    const result = await this.pool.query<{ used: number }>('SELECT used FROM chat_quota WHERE asset = $1 AND day = $2', [asset, day]);
    return result.rows[0]?.used ?? 0;
  }
}

/** Spend per UTC day in micro-dollars. `reserve` checks the cap and adds in the same statement. */
export class PgSpendLedger implements SpendLedger {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async spentMicroUsd(day: string): Promise<number> {
    const result = await this.pool.query<{ micro_usd: string }>('SELECT micro_usd FROM chat_spend WHERE day = $1', [day]);
    return Number(result.rows[0]?.micro_usd ?? 0);
  }

  async reserve(day: string, microUsd: number, capMicroUsd: number): Promise<boolean> {
    if (microUsd > capMicroUsd) return false;
    const result = await this.pool.query(
      `INSERT INTO chat_spend (day, micro_usd) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET micro_usd = chat_spend.micro_usd + $2
       WHERE chat_spend.micro_usd + $2 <= $3
       RETURNING micro_usd`,
      [day, microUsd, capMicroUsd],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async adjust(day: string, deltaMicroUsd: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat_spend (day, micro_usd) VALUES ($1, GREATEST($2::bigint, 0))
       ON CONFLICT (day) DO UPDATE SET micro_usd = GREATEST(chat_spend.micro_usd + $2::bigint, 0)`,
      [day, Math.round(deltaMicroUsd)],
    );
  }
}

interface PrivateRow {
  nickname: string | null;
  summary: string | null;
  updated_at: string;
}

/**
 * Public history follows the asset. Private memory is keyed by asset and owner
 * wallet, so a buyer reads nothing the seller said.
 */
export class PgMemoryStore implements MemoryStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async publicHistory(asset: string): Promise<readonly string[]> {
    const result = await this.pool.query<{ line: string }>(
      `SELECT line FROM (SELECT id, line FROM chat_public_memory WHERE asset = $1 ORDER BY id DESC LIMIT $2) latest ORDER BY id`,
      [asset, PUBLIC_HISTORY_LINES],
    );
    return result.rows.map((row) => row.line);
  }

  async addPublicLine(asset: string, eventKey: string, line: string, at: number): Promise<boolean> {
    const result = await this.pool.query(
      'INSERT INTO chat_public_memory (asset, event_key, line, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (asset, event_key) DO NOTHING',
      [asset, eventKey, line, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async privateMemory(asset: string, owner: string): Promise<PrivateMemory | null> {
    const result = await this.pool.query<PrivateRow>(
      'SELECT nickname, summary, updated_at FROM chat_private_memory WHERE asset = $1 AND owner = $2',
      [asset, owner],
    );
    const row = result.rows[0];
    return row ? { nickname: row.nickname, summary: row.summary, updatedAt: Number(row.updated_at) } : null;
  }

  async savePrivateMemory(asset: string, owner: string, memory: PrivateMemory): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat_private_memory (asset, owner, nickname, summary, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (asset, owner) DO UPDATE SET nickname = $3, summary = $4, updated_at = $5`,
      [asset, owner, memory.nickname, memory.summary, memory.updatedAt],
    );
  }

  async replaceSummary(asset: string, owner: string, expectedUpdatedAt: number, summary: string, at: number): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE chat_private_memory SET summary = $4, updated_at = $5 WHERE asset = $1 AND owner = $2 AND updated_at = $3',
      [asset, owner, expectedUpdatedAt, summary, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deletePrivateMemory(asset: string, owner: string): Promise<void> {
    await this.pool.query('DELETE FROM chat_private_memory WHERE asset = $1 AND owner = $2', [asset, owner]);
  }
}
