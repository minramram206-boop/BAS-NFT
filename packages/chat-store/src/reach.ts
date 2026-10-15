import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { migrate } from './schema.js';
import { createPool } from './postgres.js';

/** A store the service needs could not be reached at start. The message says which, where, and what to try. */
export class ServiceUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnreachableError';
  }
}

/** `host:port` of a connection URL, without the user name or password. */
function endpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return 'the configured address';
  }
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

function isConnectionFailure(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isConnectionFailure);
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONNECTION_CODES.has(code);
}

/**
 * Opens the Postgres pool and applies the migrations. When the database cannot be
 * reached the error names it and points at `pnpm services:up`, instead of a bare
 * `ECONNREFUSED` from deep inside the driver.
 */
export async function openDatabase(url: string): Promise<Pool> {
  const pool = createPool(url);
  try {
    await migrate(pool);
    return pool;
  } catch (error) {
    await pool.end().catch(() => undefined);
    if (!isConnectionFailure(error)) throw error;
    throw new ServiceUnreachableError(
      `Cannot reach Postgres at ${endpoint(url)}. Start it with "pnpm services:up", or comment out DATABASE_URL in .env to run without it.`,
    );
  }
}

/** Checks that Redis answers before the service starts relying on it. */
export async function checkRedis(redis: Redis, url: string, timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  // The failure is reported below in one line; the driver's own log of each retry would bury it.
  const quiet = (): void => undefined;
  redis.on('error', quiet);
  try {
    await Promise.race([redis.ping(), expired]);
  } catch {
    throw new ServiceUnreachableError(
      `Cannot reach Redis at ${endpoint(url)}. Start it with "pnpm services:up", or comment out REDIS_URL in .env to run without it.`,
    );
  } finally {
    clearTimeout(timer);
    redis.off('error', quiet);
  }
}
