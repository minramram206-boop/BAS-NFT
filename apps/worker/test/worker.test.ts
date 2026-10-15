import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  CONSOLIDATE_AT,
  InMemoryMemoryStore,
  InMemorySpendLedger,
  type ModelClient,
  createConsolidator,
  type ChatConfig,
} from '@bas/ai';
import { CHAT_QUEUE, createRedis, createUpkeepQueue } from '@bas/chat-store';
import { Queue, Worker } from 'bullmq';
import { UnreadableJobError, runJob } from '../dist/index.js';

const ASSET = 'Asset1111111111111111111111111111111111111';
const OWNER = 'Owner1111111111111111111111111111111111111';

const CONFIG: ChatConfig = {
  enabled: true,
  apiKey: 'k',
  primaryModel: 'primary/model',
  fallbackModel: null,
  maxOutputTokens: 300,
  timeoutMs: 1_000,
  reasoningEffort: null,
  dailyBudgetUsd: 1,
  prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
};

const rewrite: ModelClient = { complete: async () => ({ text: JSON.stringify({ summary: 'Wants the bridge rebuilt.' }), microUsd: 10 }) };

function deps(model: ModelClient = rewrite) {
  const memory = new InMemoryMemoryStore();
  const ledger = new InMemorySpendLedger();
  return { memory, ledger, consolidate: createConsolidator({ config: CONFIG, model, memory, ledger }) };
}

describe('upkeep jobs', () => {
  it('rewrites a long summary', async () => {
    const d = deps();
    await d.memory.savePrivateMemory(ASSET, OWNER, { nickname: null, summary: 'z'.repeat(CONSOLIDATE_AT + 5), updatedAt: 1 });
    assert.equal(await runJob(d, 'consolidate', { asset: ASSET, owner: OWNER, citizenName: 'Ivy' }), 'updated');
    assert.equal((await d.memory.privateMemory(ASSET, OWNER))?.summary, 'Wants the bridge rebuilt.');
  });

  it('adds a public line once, however often the job is delivered', async () => {
    const d = deps();
    const data = { asset: ASSET, eventKey: 'mission:3', line: 'Fixed the street lamp.' };
    assert.equal(await runJob(d, 'public-line', data), 'added');
    assert.equal(await runJob(d, 'public-line', data), 'duplicate');
    assert.deepEqual(await d.memory.publicHistory(ASSET), ['Fixed the street lamp.']);
  });

  it('refuses payloads and job names it cannot read', async () => {
    const d = deps();
    await assert.rejects(runJob(d, 'consolidate', { asset: ASSET }), UnreadableJobError);
    await assert.rejects(runJob(d, 'public-line', { asset: ASSET, eventKey: 'x', line: 'y', extra: true }), UnreadableJobError);
    await assert.rejects(runJob(d, 'something-else', {}), UnreadableJobError);
  });
});

const redisUrl = process.env.BAS_TEST_REDIS_URL;

describe('worker over a real queue', { skip: redisUrl ? false : 'set BAS_TEST_REDIS_URL to run the Redis tests' }, () => {
  const connection = createRedis(redisUrl ?? 'redis://127.0.0.1:1');
  after(async () => {
    await connection.quit();
  });

  it('picks up what the chat server queues and does the work', async () => {
    const d = deps();
    await d.memory.savePrivateMemory(ASSET, OWNER, { nickname: null, summary: 'q'.repeat(CONSOLIDATE_AT + 5), updatedAt: 1 });
    const inspect = new Queue(CHAT_QUEUE, { connection });
    await inspect.obliterate({ force: true });
    const queue = createUpkeepQueue(connection);

    const workerConnection = createRedis(redisUrl ?? '');
    const finished = new Promise<void>((resolve, reject) => {
      let remaining = 2;
      const worker = new Worker(
        CHAT_QUEUE,
        async (job) => {
          await runJob(d, job.name, job.data);
        },
        { connection: workerConnection },
      );
      worker.on('completed', () => {
        remaining -= 1;
        if (remaining === 0) void worker.close().then(() => resolve());
      });
      worker.on('failed', (_job, error) => reject(error));
    });

    await queue.enqueueConsolidation({ asset: ASSET, owner: OWNER, citizenName: 'Ivy' });
    await queue.enqueuePublicLine({ asset: ASSET, eventKey: 'mission:9', line: 'Fixed the street lamp.' });
    await finished;
    await workerConnection.quit();

    assert.equal((await d.memory.privateMemory(ASSET, OWNER))?.summary, 'Wants the bridge rebuilt.');
    assert.deepEqual(await d.memory.publicHistory(ASSET), ['Fixed the street lamp.']);
    await inspect.obliterate({ force: true });
    await inspect.close();
    await queue.close();
  });
});
