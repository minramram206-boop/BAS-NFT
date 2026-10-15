import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Queue } from 'bullmq';
import {
  CHAT_QUEUE,
  RedisConversationStore,
  RedisLock,
  createRedis,
  createUpkeepQueue,
  parseJob,
} from '../dist/index.js';

const url = process.env.BAS_TEST_REDIS_URL;
const skip = url ? false : 'set BAS_TEST_REDIS_URL to run the Redis tests';

const ASSET = 'Asset1111111111111111111111111111111111111';
const OWNER = 'Owner1111111111111111111111111111111111111';

describe('redis connection', () => {
  it('fails a command instead of waiting forever when Redis is down', async () => {
    const redis = createRedis('redis://127.0.0.1:1', { commandTimeoutMs: 200 });
    redis.on('error', () => undefined);
    const started = Date.now();
    await assert.rejects(redis.get('anything'), /timed out/i);
    assert.ok(Date.now() - started < 3_000);
    redis.disconnect();
  });

  it('fails a queued job instead of hanging when Redis is down', async () => {
    const redis = createRedis('redis://127.0.0.1:1', { commandTimeoutMs: 200 });
    redis.on('error', () => undefined);
    const queue = createUpkeepQueue(redis, { addTimeoutMs: 300 });
    const asset = 'Asset1111111111111111111111111111111111111';
    const started = Date.now();
    await assert.rejects(queue.enqueuePublicLine({ asset, eventKey: 'down-1', line: 'x' }), /did not answer/);
    assert.ok(Date.now() - started < 3_000);
    redis.disconnect();
    await queue.close().catch(() => undefined);
  });
});

describe('redis stores', { skip }, () => {
  const redis = createRedis(url ?? 'redis://127.0.0.1:1');
  after(async () => {
    await redis.quit();
  });

  it('keeps a conversation per asset and owner', async () => {
    const store = new RedisConversationStore(redis);
    const key = `${ASSET}-${Date.now()}`;
    assert.equal(await store.get(key, OWNER), null);
    const conversation = { startedAt: 1, lastAt: 2, turns: [{ from: 'owner' as const, text: 'Hi' }] };
    await store.put(key, OWNER, conversation);
    assert.deepEqual(await store.get(key, OWNER), conversation);
    assert.equal(await store.get(key, 'someone-else'), null);
  });

  it('drops a conversation on request', async () => {
    const store = new RedisConversationStore(redis);
    const key = `${ASSET}-del-${Date.now()}`;
    await store.put(key, OWNER, { startedAt: 1, lastAt: 2, turns: [{ from: 'owner' as const, text: 'Hi' }] });
    await store.delete(key, OWNER);
    assert.equal(await store.get(key, OWNER), null);
  });

  it('expires a conversation with the idle gap', async () => {
    const store = new RedisConversationStore(redis);
    const key = `${ASSET}-ttl-${Date.now()}`;
    await store.put(key, OWNER, { startedAt: 1, lastAt: 2, turns: [] });
    const ttl = await redis.pttl(`bas:chat:conversation:${key}:${OWNER}`);
    assert.ok(ttl > 29 * 60_000 && ttl <= 30 * 60_000, `ttl was ${ttl}`);
  });

  it('lets one holder in at a time and frees the key on release', async () => {
    const lock = new RedisLock(redis);
    const key = `${ASSET}:${OWNER}:${Date.now()}`;
    const release = await lock.acquire(key, 5_000);
    assert.ok(release);
    assert.equal(await lock.acquire(key, 5_000), null);
    await release();
    const again = await lock.acquire(key, 5_000);
    assert.ok(again);
    await again();
  });

  it('does not let an expired holder release the next holder', async () => {
    const lock = new RedisLock(redis);
    const key = `${ASSET}:${OWNER}:expiry-${Date.now()}`;
    const first = await lock.acquire(key, 50);
    assert.ok(first);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = await lock.acquire(key, 5_000);
    assert.ok(second);
    await first();
    assert.equal(await lock.acquire(key, 5_000), null);
    await second();
  });

  it('queues one rewrite per owner and one line per event', async () => {
    const queue = createUpkeepQueue(redis);
    const inspect = new Queue(CHAT_QUEUE, { connection: redis });
    try {
      await inspect.obliterate({ force: true });
      const job = { asset: ASSET, owner: OWNER, citizenName: 'Ivy' };
      await queue.enqueueConsolidation(job);
      await queue.enqueueConsolidation(job);
      await queue.enqueuePublicLine({ asset: ASSET, eventKey: 'mission:1', line: 'Fixed the street lamp.' });
      await queue.enqueuePublicLine({ asset: ASSET, eventKey: 'mission:1', line: 'Fixed the street lamp.' });
      const waiting = await inspect.getJobs(['waiting', 'delayed', 'active']);
      assert.deepEqual(waiting.map((entry) => entry.name).sort(), ['consolidate', 'public-line']);
      await assert.rejects(queue.enqueuePublicLine({ asset: ASSET, eventKey: '', line: 'x' }));
    } finally {
      await inspect.obliterate({ force: true });
      await inspect.close();
      await queue.close();
    }
  });
});

describe('job payloads', () => {
  it('accepts the documented shapes and nothing else', () => {
    assert.deepEqual(parseJob('consolidate', { asset: ASSET, owner: OWNER, citizenName: 'Ivy' }), { asset: ASSET, owner: OWNER, citizenName: 'Ivy' });
    assert.equal(parseJob('consolidate', { asset: ASSET, owner: OWNER }), null);
    assert.equal(parseJob('consolidate', { asset: ASSET, owner: OWNER, citizenName: 'Ivy', extra: 1 }), null);
    assert.equal(parseJob('public-line', { asset: ASSET, eventKey: 'a', line: 'x'.repeat(201) }), null);
  });
});
