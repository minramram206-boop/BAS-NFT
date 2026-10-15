import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { type CompletionRequest, type CompletionResult, type ModelClient, OpenRouterClient } from '@bas/ai';
import type { Server } from 'node:http';
import { build, goodReply, tokenFor, wallet } from './fixtures.ts';

class ScriptedModel implements ModelClient {
  readonly requests: CompletionRequest[] = [];
  private readonly texts: string[];

  constructor(...texts: string[]) {
    this.texts = texts;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const text = this.texts[Math.min(this.requests.length - 1, this.texts.length - 1)] ?? goodReply();
    return { text, microUsd: 1_000 };
  }
}

const open: Server[] = [];
after(async () => {
  await Promise.all(open.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(base: string, path: string, init: { method?: string; token?: string; body?: unknown; origin?: string } = {}) {
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

async function rig(model: ModelClient = new ScriptedModel(goodReply()), overrides: Parameters<typeof build>[1] = {}) {
  const parts = build(model, overrides);
  const base = await listen(parts.server);
  const asset = wallet();
  const owner = wallet();
  parts.chain.register(asset, owner);
  return { ...parts, base, asset, owner, token: tokenFor(owner) };
}

describe('chat server', () => {
  it('answers the health check without a token', async () => {
    const r = await rig();
    assert.deepEqual((await call(r.base, '/health')).json, { ok: true });
  });

  it('needs a valid token for everything else', async () => {
    const r = await rig();
    assert.equal((await call(r.base, `/chat/${r.asset}/status`)).status, 401);
    assert.equal((await call(r.base, `/chat/${r.asset}/status`, { token: 'forged.token' })).status, 401);
  });

  it('shows the owner the citizen and the quota', async () => {
    const r = await rig();
    const status = await call(r.base, `/chat/${r.asset}/status`, { token: r.token });
    assert.equal(status.status, 200);
    assert.deepEqual(status.json.citizen, { name: 'Ivy' });
    assert.equal(status.json.remaining, 20);
    assert.equal(status.json.enabled, true);
  });

  it('answers an owner message and counts it', async () => {
    const model = new ScriptedModel(goodReply('Welcome back.'));
    const r = await rig(model);
    const sent = await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Hello Ivy' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.kind, 'reply');
    assert.equal(sent.json.reply, 'Welcome back.');
    assert.equal(sent.json.remaining, 19);
    assert.equal(model.requests.length, 1);
    assert.match(model.requests[0]?.messages[0]?.content ?? '', /You are Ivy, a Steward/);
  });

  it('refuses anyone who does not hold the asset, before the model is called', async () => {
    const model = new ScriptedModel(goodReply());
    const r = await rig(model);
    const stranger = tokenFor(wallet());
    assert.equal((await call(r.base, `/chat/${r.asset}/status`, { token: stranger })).status, 403);
    const sent = await call(r.base, `/chat/${r.asset}/messages`, { token: stranger, body: { message: 'Hi' } });
    assert.equal(sent.status, 403);
    assert.equal(sent.json.error, 'not-owner');
    assert.equal(model.requests.length, 0);
  });

  it('follows the asset to a new owner on the very next request', async () => {
    const model = new ScriptedModel(goodReply());
    const r = await rig(model);
    const buyer = wallet();
    assert.equal((await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Hi' } })).status, 200);
    r.chain.owners.set(r.asset, buyer);
    assert.equal((await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Hi' } })).status, 403);
    const bought = await call(r.base, `/chat/${r.asset}/messages`, { token: tokenFor(buyer), body: { message: 'Hi' } });
    assert.equal(bought.status, 200);
    // The quota belongs to the asset, so the sale did not refill it.
    assert.equal(bought.json.remaining, 18);
  });

  it('never puts the seller\'s private memory in front of the buyer, but keeps the public history', async () => {
    const model = new ScriptedModel(goodReply('Noted.', 'Likes to be called Boss'));
    const r = await rig(model);
    await r.memory.addPublicLine(r.asset, 'mission:1', 'Fixed the street lamp.', 1);
    await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Call me Boss' } });
    await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'What do you remember?' } });
    const sellerPrompt = JSON.stringify(model.requests.at(-1));
    assert.match(sellerPrompt, /Boss/);
    assert.match(sellerPrompt, /Fixed the street lamp\./);

    const buyer = wallet();
    r.chain.owners.set(r.asset, buyer);
    const sent = await call(r.base, `/chat/${r.asset}/messages`, { token: tokenFor(buyer), body: { message: 'Hello, who are you?' } });
    assert.equal(sent.status, 200);
    const buyerPrompt = JSON.stringify(model.requests.at(-1));
    assert.doesNotMatch(buyerPrompt, /Boss/);
    assert.doesNotMatch(buyerPrompt, /What do you remember/);
    assert.match(buyerPrompt, /Fixed the street lamp\./);
  });

  it('reports unknown and unregistered assets as not found', async () => {
    const r = await rig();
    const unknown = wallet();
    assert.equal((await call(r.base, `/chat/${unknown}/status`, { token: r.token })).json.error, 'citizen-not-found');
    r.chain.citizens.delete(r.asset);
    assert.equal((await call(r.base, `/chat/${r.asset}/status`, { token: r.token })).status, 404);
  });

  it('rejects empty, over-long and malformed messages', async () => {
    const model = new ScriptedModel(goodReply());
    const r = await rig(model);
    const send = (body: unknown) => call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body });
    assert.equal((await send({ message: '  ' })).json.error, 'empty');
    assert.equal((await send({ message: 'x'.repeat(301) })).json.error, 'too-long');
    assert.equal((await send({ message: 42 })).json.error, 'bad-request');
    assert.equal((await send({})).json.error, 'bad-request');
    assert.equal(model.requests.length, 0);
  });

  it('reports the quota as spent once the daily limit is reached', async () => {
    const r = await rig(new ScriptedModel(goodReply()), { limit: 1 });
    const send = () => call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Hi' } });
    assert.equal((await send()).json.kind, 'reply');
    const second = await send();
    assert.equal(second.json.kind, 'unavailable');
    assert.equal(second.json.reason, 'quota');
    assert.ok(second.json.quotaResetsInMs > 0);
  });

  it('says chat is unavailable, without inventing a reply, when it is switched off', async () => {
    const model = new ScriptedModel(goodReply());
    const r = await rig(model, { config: { enabled: false } });
    const sent = await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Hi' } });
    assert.equal(sent.json.kind, 'unavailable');
    assert.equal(sent.json.reason, 'disabled');
    assert.equal('reply' in sent.json, false);
    assert.equal(model.requests.length, 0);
  });

  it('lets any wallet read and delete its own memory, even after selling the citizen', async () => {
    const remember = goodReply('Noted.', 'Likes to be called Boss');
    const r = await rig(new ScriptedModel(remember));
    await r.memory.addPublicLine(r.asset, 'mission:1', 'Fixed the street lamp.', 1);
    await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Call me Boss' } });

    r.chain.owners.set(r.asset, wallet());
    const mine = await call(r.base, `/chat/${r.asset}/memory`, { token: r.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.nickname, 'Boss');
    assert.deepEqual(mine.json.publicHistory, ['Fixed the street lamp.']);

    const stranger = await call(r.base, `/chat/${r.asset}/memory`, { token: tokenFor(wallet()) });
    assert.equal(stranger.json.nickname, null);
    assert.equal(stranger.json.summary, null);

    assert.equal((await call(r.base, `/chat/${r.asset}/memory`, { method: 'DELETE', token: r.token })).status, 200);
    assert.equal((await call(r.base, `/chat/${r.asset}/memory`, { token: r.token })).json.nickname, null);
  });

  it('forgets the open conversation too, so the next prompt carries nothing from before', async () => {
    const model = new ScriptedModel(goodReply('Noted.', 'Likes to be called Boss'));
    const r = await rig(model);
    await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Call me Boss' } });
    await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Still there?' } });
    assert.ok(JSON.stringify(model.requests[1]?.messages).includes('Call me Boss'));

    assert.equal((await call(r.base, `/chat/${r.asset}/memory`, { method: 'DELETE', token: r.token })).status, 200);
    await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Who am I?' } });
    const prompt = JSON.stringify(model.requests[2]?.messages);
    assert.equal(prompt.includes('Call me Boss'), false);
    assert.equal(prompt.includes('Boss'), false);
  });

  it('limits requests per client and answers CORS only for the web app', async () => {
    const r = await rig(new ScriptedModel(goodReply()), { rateLimit: 5 });
    const allowed = await call(r.base, '/health', { origin: 'http://localhost:3000' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal((await call(r.base, '/health', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call(r.base, '/health')).status);
    assert.equal(statuses.includes(429), true);
  });

  it('talks to the gateway the way the spec says: key from the server, JSON mode, no tools', async () => {
    const seen: { auth: string | undefined; body: any }[] = [];
    const gateway = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.push({ auth: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: goodReply('From the gateway.') } }], usage: { prompt_tokens: 400, completion_tokens: 30, cost: 0.0004 } }));
      });
    });
    const gatewayBase = await listen(gateway);
    const model = new OpenRouterClient({ apiKey: 'sk-test', prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 }, baseUrl: gatewayBase });
    const r = await rig(model);
    const sent = await call(r.base, `/chat/${r.asset}/messages`, { token: r.token, body: { message: 'Hello' } });
    assert.equal(sent.json.reply, 'From the gateway.');
    assert.equal(seen[0]?.auth, 'Bearer sk-test');
    assert.equal(seen[0]?.body.model, 'primary/model');
    assert.deepEqual(seen[0]?.body.response_format, { type: 'json_object' });
    assert.equal('tools' in (seen[0]?.body ?? {}), false);
    // What the gateway reported (0.0004 USD) is what the ledger holds.
    assert.equal(await r.ledger.spentMicroUsd('2026-10-14'), 400);
  });
});
