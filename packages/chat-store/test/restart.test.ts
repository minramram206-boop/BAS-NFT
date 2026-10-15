import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  type ChatConfig,
  type CompletionRequest,
  type ModelClient,
  createChatService,
} from '@bas/ai';
import { PgMemoryStore, PgQuotaStore, PgSpendLedger, RedisConversationStore, RedisLock, createPool, createRedis, migrate } from '../dist/index.js';

const databaseUrl = process.env.BAS_TEST_DATABASE_URL;
const redisUrl = process.env.BAS_TEST_REDIS_URL;
const skip = databaseUrl && redisUrl ? false : 'set BAS_TEST_DATABASE_URL and BAS_TEST_REDIS_URL to run the restart tests';

const CONFIG: ChatConfig = {
  enabled: true,
  apiKey: 'test-key',
  primaryModel: 'primary/model',
  fallbackModel: 'fallback/model',
  maxOutputTokens: 300,
  timeoutMs: 5_000,
  reasoningEffort: null,
  dailyBudgetUsd: 1,
  prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
};

class Model implements ModelClient {
  readonly requests: CompletionRequest[] = [];
  private readonly answers: string[];

  constructor(answers: string[]) {
    this.answers = answers;
  }

  async complete(request: CompletionRequest) {
    this.requests.push(request);
    return { text: this.answers[Math.min(this.requests.length, this.answers.length) - 1] ?? '', microUsd: 100 };
  }
}

const reply = (text: string, memoryCandidate: string | null) =>
  JSON.stringify({ reply: text, emotion: 'happy', animation: 'happy', memoryCandidate, safety: 'ok' });

/** A fresh set of connections and a fresh service, as after the chat server is restarted. */
async function boot(model: ModelClient, url: string, redisAddress: string) {
  const pool = createPool(url);
  await migrate(pool);
  const redis = createRedis(redisAddress);
  const service = createChatService({
    config: CONFIG,
    dailyMessageLimit: 20,
    model,
    quota: new PgQuotaStore(pool),
    memory: new PgMemoryStore(pool),
    conversations: new RedisConversationStore(redis),
    ledger: new PgSpendLedger(pool),
    lock: new RedisLock(redis),
  });
  const memory = new PgMemoryStore(pool);
  return { service, memory, close: () => Promise.all([pool.end(), redis.quit()]) };
}

describe('chat state across a restart', { skip }, () => {
  const asset = `Restart${Date.now()}`.padEnd(44, '1');
  const owner = 'Owner1111111111111111111111111111111111111';
  const citizen = { asset, name: 'Ivy', roleKey: 'steward', role: 'Steward', lore: 'Keeps the lamps lit.', scores: { intelligence: 1, alignment: 2, compute: 0 } };
  const closers: (() => Promise<unknown>)[] = [];
  after(async () => {
    for (const close of closers) await close();
  });

  it('remembers the nickname, the open conversation and the quota after a restart, and forgets on request', async () => {
    const first = await boot(new Model([reply('Hello, Boss.', 'Likes to be called Boss')]), databaseUrl ?? '', redisUrl ?? '');
    const said = await first.service.respond({ citizen, owner, message: 'Panggil aku Boss' });
    assert.equal(said.kind, 'reply');
    await first.close();

    const model = new Model([reply('Yes, Boss.', null)]);
    const second = await boot(model, databaseUrl ?? '', redisUrl ?? '');
    closers.push(second.close);
    assert.match(JSON.stringify(await second.memory.privateMemory(asset, owner)), /Boss/);
    assert.equal((await second.service.status(asset, owner)).remaining, 19);

    await second.service.respond({ citizen, owner, message: 'Siapa namaku?' });
    const sent = JSON.stringify(model.requests[0]?.messages);
    assert.match(sent, /Panggil aku Boss/, 'the earlier turn should still be in the conversation');
    assert.match(sent, /Boss/);

    assert.equal(await second.service.forget(asset, owner), true);
    assert.equal(await second.memory.privateMemory(asset, owner), null);
    const after = new Model([reply('Hello.', null)]);
    const third = await boot(after, databaseUrl ?? '', redisUrl ?? '');
    closers.push(third.close);
    await third.service.respond({ citizen, owner, message: 'Siapa namaku?' });
    assert.doesNotMatch(JSON.stringify(after.requests[0]?.messages), /Panggil aku Boss/);
  });
});
