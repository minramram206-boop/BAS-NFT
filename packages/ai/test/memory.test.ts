import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_SUMMARY_CHARS, mergeCandidate } from '../dist/index.js';

const NONE = null;

describe('mergeCandidate', () => {
  it('takes a nickname from the phrasings a model uses', () => {
    for (const [fact, nickname] of [
      ['Likes to be called Boss', 'Boss'],
      ['The owner prefers to be called bos.', 'bos'],
      ['Owner wants to be called "Big Boss"', 'Big Boss'],
      ['Nickname: Sejuaju', 'Sejuaju'],
    ] as const) {
      assert.equal(mergeCandidate(NONE, fact, 1).nickname, nickname, fact);
      assert.equal(mergeCandidate(NONE, fact, 1).summary, null, fact);
    }
  });

  it('keeps the summary when a nickname arrives, and the nickname when a fact arrives', () => {
    const first = mergeCandidate({ nickname: null, summary: 'Likes the harbor.', updatedAt: 1 }, 'Likes to be called bos', 2);
    assert.deepEqual(first, { nickname: 'bos', summary: 'Likes the harbor.', updatedAt: 2 });
    const second = mergeCandidate(first, 'Plans to rebuild the east bridge.', 3);
    assert.equal(second.nickname, 'bos');
    assert.equal(second.summary, 'Likes the harbor. Plans to rebuild the east bridge.');
  });

  it('does nothing when the model repeats a nickname or a fact it already has', () => {
    const start = { nickname: 'bos', summary: 'Likes the harbor.', updatedAt: 1 };
    assert.deepEqual(mergeCandidate(start, 'The owner prefers to be called bos', 9), start);
    assert.deepEqual(mergeCandidate(start, 'likes the harbor', 9), start);
    assert.deepEqual(mergeCandidate(start, '   ', 9), start);
  });

  it('does not let repeated candidates grow the notes', () => {
    let memory = mergeCandidate(NONE, 'Plans to rebuild the east bridge.', 1);
    for (let i = 0; i < 10; i += 1) memory = mergeCandidate(memory, 'Plans to rebuild the east bridge', 2 + i);
    assert.equal(memory.summary, 'Plans to rebuild the east bridge.');
  });

  it('still trims the oldest text when the summary outgrows its cap', () => {
    const long = 'x'.repeat(MAX_SUMMARY_CHARS - 5);
    const merged = mergeCandidate({ nickname: null, summary: long, updatedAt: 1 }, 'A brand new fact here.', 2);
    assert.equal(merged.summary?.length, MAX_SUMMARY_CHARS);
    assert.ok(merged.summary?.endsWith('A brand new fact here.'));
  });
});
