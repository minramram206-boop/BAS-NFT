import { OpenRouterClient, createConsolidator, loadChatConfig } from '@bas/ai';
import {
  CHAT_QUEUE,
  PgMemoryStore,
  PgSpendLedger,
  ServiceUnreachableError,
  checkRedis,
  createRedis,
  openDatabase,
} from '@bas/chat-store';
import { UnrecoverableError, Worker } from 'bullmq';
import { UnreadableJobError, runJob } from './handlers.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = process.env.REDIS_URL?.trim();
if (!databaseUrl || !redisUrl) {
  console.error('[worker] DATABASE_URL and REDIS_URL are required');
  process.exit(1);
}

const chat = loadChatConfig(process.env);
const { pool, redis } = await (async () => {
  try {
    const opened = await openDatabase(databaseUrl);
    const connection = createRedis(redisUrl);
    await checkRedis(connection, redisUrl);
    return { pool: opened, redis: connection };
  } catch (error) {
    if (!(error instanceof ServiceUnreachableError)) throw error;
    console.error(`[worker] ${error.message}`);
    process.exit(1);
  }
})();
const memory = new PgMemoryStore(pool);
const ledger = new PgSpendLedger(pool);

const consolidate = createConsolidator({
  config: chat,
  model: new OpenRouterClient({ apiKey: chat.apiKey, prices: chat.prices, reasoningEffort: chat.reasoningEffort }),
  memory,
  ledger,
});

const worker = new Worker(
  CHAT_QUEUE,
  async (job) => {
    try {
      const outcome = await runJob({ memory, consolidate }, job.name, job.data);
      console.log(`[worker] ${job.name} ${outcome}`);
    } catch (error) {
      // A payload this version cannot read will never become readable, so it is not retried.
      if (error instanceof UnreadableJobError) throw new UnrecoverableError(error.message);
      throw error;
    }
  },
  { connection: redis, concurrency: 2 },
);

worker.on('failed', (job, error) => console.error(`[worker] ${job?.name ?? 'job'} failed: ${error.message}`));
console.log('[worker] waiting for jobs');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.close().then(() => Promise.all([redis.quit(), pool.end()])).finally(() => process.exit(0));
  });
}
