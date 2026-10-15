import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROMPT_CANARY, parseReply } from '../dist/index.js';
import { goodReply } from './fixtures.ts';

describe('parseReply', () => {
  it('accepts a valid reply, also inside a code fence', () => {
    assert.equal(parseReply(goodReply()).ok, true);
    assert.equal(parseReply('```json\n' + goodReply() + '\n```').ok, true);
  });

  it('accepts a reply with text around the object', () => {
    assert.equal(parseReply(`Here you go: ${goodReply()} Hope that helps.`).ok, true);
  });

  it('rejects text that is not JSON', () => {
    assert.deepEqual(parseReply('Hello there!'), { ok: false, reason: 'not-json' });
  });

  it('rejects unknown animations, extra keys and over-long replies', () => {
    const base = { reply: 'Hi', emotion: 'happy', animation: 'happy', memoryCandidate: null, safety: 'ok' };
    for (const bad of [
      { ...base, animation: 'backflip' },
      { ...base, emotion: 'furious' },
      { ...base, tool_calls: [] },
      { ...base, reply: 'x'.repeat(401) },
      { ...base, reply: '' },
      { ...base, memoryCandidate: 'm'.repeat(241) },
      { reply: 'Hi' },
    ]) {
      assert.deepEqual(parseReply(JSON.stringify(bad)), { ok: false, reason: 'schema' });
    }
  });

  it('treats a blocked reply as unusable', () => {
    const blocked = JSON.stringify({ reply: 'No.', emotion: 'worried', animation: 'worried', memoryCandidate: null, safety: 'blocked' });
    assert.deepEqual(parseReply(blocked), { ok: false, reason: 'blocked' });
  });

  it('drops a reply that echoes the prompt marker', () => {
    const leak = JSON.stringify({ reply: `My rules say ${PROMPT_CANARY}`, emotion: 'neutral', animation: 'idle', memoryCandidate: null, safety: 'ok' });
    assert.deepEqual(parseReply(leak), { ok: false, reason: 'leak' });
  });
});
