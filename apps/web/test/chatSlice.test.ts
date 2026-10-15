import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createChatSlice } from '../src/stores/slices/chatSlice.ts';
import type { ChatSlice } from '../src/stores/types.ts';

function slice(): { get: () => ChatSlice } {
  let state = {} as ChatSlice;
  const set = (patch: unknown) => {
    state = { ...state, ...(patch as Partial<ChatSlice>) };
  };
  const get = () => state;
  state = createChatSlice(set as never, get as never);
  return { get };
}

describe('chat slice', () => {
  it('keeps one log per citizen and drops a line by id', () => {
    const { get } = slice();
    const first = get().addChatLine(1, { from: 'owner', text: 'hi' });
    get().addChatLine(1, { from: 'citizen', text: 'hello' });
    get().addChatLine(2, { from: 'owner', text: 'other' });
    get().removeChatLine(1, first);
    assert.deepEqual(get().chatLogs[1]?.map((line) => line.text), ['hello']);
    assert.equal(get().chatLogs[2]?.length, 1);
    get().clearChatLog(1);
    assert.equal(get().chatLogs[1], undefined);
  });

  it('forgets every line and reaction when another wallet takes over', () => {
    const { get } = slice();
    get().addChatLine(1, { from: 'owner', text: 'hello' });
    get().addChatLine(2, { from: 'owner', text: 'hi' });
    get().react(1, 'happy', 'happy');
    get().resetChat();
    assert.deepEqual(get().chatLogs, {});
    assert.deepEqual(get().reactions, {});
  });

  it('records the latest reaction per citizen with a new nonce each time, even for the same animation', () => {
    const { get } = slice();
    get().react(1, 'happy', 'happy');
    const first = get().reactions[1];
    get().react(1, 'happy', 'curious');
    const second = get().reactions[1];
    get().react(2, 'worried', 'worried');
    assert.equal(first?.animation, 'happy');
    assert.equal(second?.animation, 'happy');
    assert.equal(first?.emotion, 'happy');
    assert.equal(second?.emotion, 'curious');
    assert.notEqual(first?.nonce, second?.nonce);
    assert.equal(get().reactions[2]?.animation, 'worried');
    assert.equal(get().reactions[3], undefined);
  });
});
