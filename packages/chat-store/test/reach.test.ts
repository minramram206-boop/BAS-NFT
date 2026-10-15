import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnreachableError, checkRedis, createRedis, openDatabase } from '../dist/index.js';

describe('start-up checks', () => {
  it('names an unreachable Postgres and hides the password', async () => {
    await assert.rejects(openDatabase('postgres://bas:secret-word@127.0.0.1:1/bas'), (error: unknown) => {
      assert.ok(error instanceof ServiceUnreachableError);
      assert.match(error.message, /Postgres at 127\.0\.0\.1:1/);
      assert.match(error.message, /pnpm services:up/);
      assert.doesNotMatch(error.message, /secret-word/);
      return true;
    });
  });

  it('names an unreachable Redis and hides the password', async () => {
    const redis = createRedis('redis://:secret-word@127.0.0.1:1', { commandTimeoutMs: 200 });
    redis.on('error', () => undefined);
    await assert.rejects(checkRedis(redis, 'redis://:secret-word@127.0.0.1:1', 500), (error: unknown) => {
      assert.ok(error instanceof ServiceUnreachableError);
      assert.match(error.message, /Redis at 127\.0\.0\.1:1/);
      assert.doesNotMatch(error.message, /secret-word/);
      return true;
    });
    redis.disconnect();
  });
});
