import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MissionApi, MissionApiError } from '../src/lib/data/chain/missionApi.ts';
import { testWallet } from './chainWorld.ts';

interface Call {
  method: string;
  path: string;
  token: string | undefined;
  body: unknown;
}

/** A server stub: `reply` picks the response of each non-auth call. */
function stub(reply: (call: Call, index: number) => { status: number; body: unknown } | Error) {
  const calls: Call[] = [];
  let tokens = 0;
  let work = 0;
  const fetchStub = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      token: headers.authorization?.replace('Bearer ', ''),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    let result: { status: number; body: unknown } | Error;
    if (path === '/auth/challenge') result = { status: 200, body: { nonce: 'n', message: 'sign me' } };
    else if (path === '/auth/verify') result = { status: 200, body: { token: `token-${(tokens += 1)}` } };
    else result = reply(call, work++);
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchStub };
}

const OK = { status: 200, body: { points: 0 } };

describe('mission api', () => {
  it('signs in once and sends the token with every call', async () => {
    const wallet = testWallet();
    const server = stub(() => OK);
    const api = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: server.fetch });
    await api.status('asset1');
    await api.start('asset1', 'streetLamp', 'compute');
    assert.equal(wallet.prompts.message, 1);
    assert.deepEqual(server.calls.filter((call) => !call.path.startsWith('/auth')).map((call) => call.token), ['token-1', 'token-1']);
    assert.deepEqual(server.calls.at(-1)!.body, { missionId: 'streetLamp', stat: 'compute' });
  });

  it('does not sign in for the public season data', async () => {
    const wallet = testWallet();
    const server = stub(() => OK);
    const api = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: server.fetch });
    await api.season();
    await api.standings();
    assert.equal(wallet.prompts.message, 0);
    assert.deepEqual(server.calls.map((call) => call.token), [undefined, undefined]);
  });

  it('signs in again once when the token is refused, then retries', async () => {
    const wallet = testWallet();
    const server = stub((call) =>
      call.token === 'token-1' ? { status: 401, body: { error: 'unauthorized' } } : { status: 200, body: { points: 7 } },
    );
    const api = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: server.fetch });
    const status = await api.status('asset1');
    assert.equal((status as unknown as { points: number }).points, 7);
    assert.equal(wallet.prompts.message, 2);
  });

  it('gives up when a fresh token is refused as well', async () => {
    const wallet = testWallet();
    const server = stub(() => ({ status: 401, body: { error: 'unauthorized' } }));
    const api = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: server.fetch });
    await assert.rejects(() => api.status('asset1'), (error: unknown) => error instanceof MissionApiError && error.code === 'unauthorized');
    assert.equal(wallet.prompts.message, 2);
  });

  it('turns a refusal into its code and a dead link into unavailable', async () => {
    const wallet = testWallet();
    const refusing = stub(() => ({ status: 422, body: { error: 'wrong-answer', message: 'no' } }));
    const api = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: refusing.fetch });
    await assert.rejects(() => api.step('a', 'lightsOut', { kind: 'talk', answer: 0 }), (error: unknown) => (error as MissionApiError).code === 'wrong-answer');

    const dead = stub(() => new TypeError('fetch failed'));
    const offline = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: dead.fetch });
    await assert.rejects(() => offline.season(), (error: unknown) => (error as MissionApiError).code === 'unavailable');

    const garbage = stub(() => ({ status: 502, body: 'bad gateway' }));
    const proxy = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: garbage.fetch });
    await assert.rejects(() => proxy.season(), (error: unknown) => (error as MissionApiError).code === 'unavailable');
  });

  it('needs a connected wallet for anything personal, and forgets the token on disconnect', async () => {
    let wallet: ReturnType<typeof testWallet> | null = null;
    const server = stub(() => OK);
    const api = new MissionApi({ baseUrl: 'http://x.test', wallet: () => wallet, fetch: server.fetch });
    await assert.rejects(() => api.status('a'), (error: unknown) => (error as MissionApiError).code === 'not-connected');

    wallet = testWallet();
    await api.status('a');
    assert.equal(api.signedIn, true);
    api.forget();
    assert.equal(api.signedIn, false);
    wallet = testWallet();
    await api.status('a');
    assert.equal(wallet.prompts.message, 1, 'a different wallet signs in for itself');
  });
});
