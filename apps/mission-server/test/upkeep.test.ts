import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openUpkeep } from '../dist/index.js';

function recorder() {
  const lines: string[] = [];
  return { lines, log: { log: (m: string) => void lines.push(m), warn: (m: string) => void lines.push(m) } };
}

describe('history queue at start', () => {
  it('is skipped, with a note, when no Redis is configured', async () => {
    const { lines, log } = recorder();
    assert.equal(await openUpkeep(undefined, log), undefined);
    assert.match(lines.join('\n'), /REDIS_URL is not set/);
  });

  it('is skipped, not fatal, when Redis does not answer', async () => {
    const { lines, log } = recorder();
    const started = Date.now();
    assert.equal(await openUpkeep('redis://:secret-word@127.0.0.1:1', log), undefined);
    assert.ok(Date.now() - started < 10_000);
    assert.match(lines.join('\n'), /Cannot reach Redis at 127\.0\.0\.1:1/);
    assert.doesNotMatch(lines.join('\n'), /secret-word/);
  });
});
