import {
  type ConversationLock,
  type ConversationStore,
  InMemoryConversationStore,
  InMemoryLock,
  InMemoryMemoryStore,
  InMemoryQuotaStore,
  InMemorySpendLedger,
  type MemoryStore,
  type QuotaStore,
  type SpendLedger,
} from '@bas/ai';
import {
  PgMemoryStore,
  PgQuotaStore,
  PgSpendLedger,
  RedisConversationStore,
  RedisLock,
  type UpkeepQueue,
  checkRedis,
  createRedis,
  createUpkeepQueue,
  openDatabase,
} from '@bas/chat-store';
import type { ServerConfig } from './config.js';

/** Long enough for a busy Redis, short enough that an owner is not left waiting on a dead one. */
const REDIS_COMMAND_TIMEOUT_MS = 5_000;

export interface Stores {
  readonly quota: QuotaStore;
  readonly memory: MemoryStore;
  readonly ledger: SpendLedger;
  readonly conversations: ConversationStore;
  readonly lock: ConversationLock;
  /** Present only with Redis; without a worker nothing would consume it. */
  readonly queue: UpkeepQueue | undefined;
  close(): Promise<void>;
}

/**
 * Postgres and Redis when configured. Otherwise the in-process stores, which
 * are for local development only: `loadServerConfig` already refuses that on
 * mainnet.
 */
export async function createStores(config: ServerConfig): Promise<Stores> {
  const closers: (() => Promise<unknown>)[] = [];

  let quota: QuotaStore = new InMemoryQuotaStore();
  let memory: MemoryStore = new InMemoryMemoryStore();
  let ledger: SpendLedger = new InMemorySpendLedger();
  if (config.databaseUrl) {
    const pool = await openDatabase(config.databaseUrl);
    quota = new PgQuotaStore(pool);
    memory = new PgMemoryStore(pool);
    ledger = new PgSpendLedger(pool);
    closers.push(() => pool.end());
  } else {
    console.warn('[chat-server] DATABASE_URL is not set: quota, budget and memory are kept in this process only');
  }

  let conversations: ConversationStore = new InMemoryConversationStore();
  let lock: ConversationLock = new InMemoryLock();
  let queue: UpkeepQueue | undefined;
  if (config.redisUrl) {
    const redis = createRedis(config.redisUrl, { commandTimeoutMs: REDIS_COMMAND_TIMEOUT_MS });
    closers.push(() => redis.quit());
    await checkRedis(redis, config.redisUrl);
    conversations = new RedisConversationStore(redis);
    lock = new RedisLock(redis);
    const jobs = createUpkeepQueue(redis);
    queue = jobs;
    closers.push(() => jobs.close());
  } else {
    console.warn('[chat-server] REDIS_URL is not set: conversations and locks are kept in this process only');
  }

  return {
    quota,
    memory,
    ledger,
    conversations,
    lock,
    queue,
    close: async () => {
      for (const close of closers) await close();
    },
  };
}
