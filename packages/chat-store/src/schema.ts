import type { Pool } from 'pg';

/** Ordered, append-only list. A migration that has run is never edited; a change is a new entry. */
export const MIGRATIONS: readonly { readonly id: string; readonly sql: string }[] = [
  {
    id: '0001-chat',
    sql: `
      CREATE TABLE chat_quota (
        asset text NOT NULL,
        day text NOT NULL,
        used integer NOT NULL CHECK (used >= 0),
        PRIMARY KEY (asset, day)
      );
      CREATE TABLE chat_spend (
        day text PRIMARY KEY,
        micro_usd bigint NOT NULL CHECK (micro_usd >= 0)
      );
      CREATE TABLE chat_private_memory (
        asset text NOT NULL,
        owner text NOT NULL,
        nickname text,
        summary text,
        updated_at bigint NOT NULL,
        PRIMARY KEY (asset, owner)
      );
      CREATE TABLE chat_public_memory (
        id bigserial PRIMARY KEY,
        asset text NOT NULL,
        event_key text NOT NULL,
        line text NOT NULL,
        created_at bigint NOT NULL,
        UNIQUE (asset, event_key)
      );
    `,
  },
];

/** Arbitrary but fixed, so two servers starting together take turns instead of racing. */
const MIGRATION_LOCK = 7_203_981;

/** Applies the migrations that have not run yet. Safe to call on every start. */
export async function migrate(pool: Pool): Promise<readonly string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS chat_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ id: string }>('SELECT id FROM chat_migrations')).rows.map((row) => row.id));
    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO chat_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(migration.id);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return applied;
}
