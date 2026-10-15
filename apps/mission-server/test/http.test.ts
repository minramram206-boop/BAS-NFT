import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { Authenticator, createMissionServer } from '../dist/index.js';
import { rig, signMessage, type Rig } from './fixtures.ts';

describe('http api', () => {
  let r: Rig;
  let base = '';
  let close = (): Promise<void> => Promise.resolve();

  before(async () => {
    r = rig();
    const server = createMissionServer({
      service: r.service,
      auth: new Authenticator(Buffer.alloc(32, 5)),
      allowedOrigins: ['http://localhost:3000'],
      rateLimit: 40,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });

  after(() => close());

  async function call(path: string, init: { method?: string; token?: string; body?: unknown; origin?: string } = {}) {
    const response = await fetch(base + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.origin ? { origin: init.origin } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, headers: response.headers, json: (await response.json().catch(() => null)) as any };
  }

  async function signIn(wallet: Keypair): Promise<string> {
    const challenge = await call('/auth/challenge', { body: { wallet: wallet.publicKey.toBase58() } });
    assert.equal(challenge.status, 200);
    const verified = await call('/auth/verify', {
      body: {
        wallet: wallet.publicKey.toBase58(),
        nonce: challenge.json.nonce,
        signature: signMessage(wallet, challenge.json.message).toString('base64'),
      },
    });
    assert.equal(verified.status, 200);
    return verified.json.token as string;
  }

  it('answers the health check', async () => {
    assert.deepEqual((await call('/health')).json, { ok: true });
  });

  it('plays the start of a mission after signing in', async () => {
    const token = await signIn(r.owner);
    const missions = `/citizens/${r.asset}/missions`;

    const status = await call(missions, { token });
    assert.equal(status.status, 200);
    assert.equal(status.json.session, null);

    const started = await call(`${missions}/start`, { token, body: { missionId: 'streetLamp', stat: 'compute' } });
    assert.equal(started.status, 200);
    assert.equal(started.json.session.missionId, 'streetLamp');

    const early = await call(`${missions}/step`, { token, body: { missionId: 'streetLamp', proof: { kind: 'goto' } } });
    assert.equal(early.status, 429);
    assert.equal(early.json.error, 'too-fast');

    const busy = await call(`${missions}/start`, { token, body: { missionId: 'lightsOut', stat: 'intelligence' } });
    assert.equal(busy.status, 409);
    assert.equal(busy.json.error, 'citizen-busy');

    assert.equal((await call(`${missions}/abandon`, { token, body: {} })).status, 200);
  });

  it('refuses a request without a token, and a token of another wallet on this citizen', async () => {
    const missions = `/citizens/${r.asset}/missions`;
    assert.equal((await call(missions)).status, 401);
    const stranger = await signIn(Keypair.generate());
    const response = await call(`${missions}/start`, { token: stranger, body: { missionId: 'streetLamp', stat: 'compute' } });
    assert.equal(response.status, 403);
    assert.equal(response.json.error, 'not-owner');
  });

  it('refuses bad input without crashing', async () => {
    const token = await signIn(r.owner);
    const missions = `/citizens/${r.asset}/missions`;
    assert.equal((await call(`${missions}/start`, { token, body: { missionId: 'streetLamp', stat: 'luck' } })).json.error, 'invalid-stat');
    assert.equal((await call(`${missions}/start`, { token, body: { stat: 'compute' } })).json.error, 'bad-request');
    assert.equal((await call(`${missions}/step`, { token, body: { missionId: 'streetLamp', proof: { kind: 'fly' } } })).json.error, 'bad-request');
    assert.equal((await call(`${missions}/start`, { token, body: { missionId: 'nope', stat: 'compute' } })).status, 404);
    assert.equal((await call('/elsewhere')).status, 400);

    const large = await call(`${missions}/start`, { token, body: { missionId: 'x'.repeat(5_000), stat: 'compute' } });
    assert.equal(large.status, 400);
  });

  it('sends CORS headers only to the web app', async () => {
    const allowed = await call('/health', { origin: 'http://localhost:3000' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const other = await call('/health', { origin: 'https://example.com' });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });

  it('serves the standings without a token', async () => {
    const response = await call('/season/standings');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.json.standings));
  });

  it('serves the season clock and event windows without a token', async () => {
    const response = await call('/season');
    assert.equal(response.status, 200);
    assert.equal(response.json.id, 1);
    assert.equal(response.json.days, 28);
    assert.equal(response.json.day, 1);
    assert.equal(response.json.open, true);
    assert.deepEqual(response.json.events, {});
  });

  it('limits a client that sends too many requests', async () => {
    let limited = 0;
    for (let index = 0; index < 60; index += 1) {
      if ((await call('/health')).status === 429) limited += 1;
    }
    assert.ok(limited > 0);
  });
});
