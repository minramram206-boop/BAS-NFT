import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChatConfigError, ModelError, OpenRouterClient, loadChatConfig } from '../dist/index.js';

const request = { model: 'm/x', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100, timeoutMs: 50 };
const prices = { inputPerMillionUsd: 1, outputPerMillionUsd: 2 };

const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe('OpenRouterClient', () => {
  it('sends a JSON-mode request without tools and reads the cost the gateway reports', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new OpenRouterClient({
      apiKey: 'secret-key',
      prices,
      fetch: async (url, init) => {
        seen = { url: String(url), init: init ?? {} };
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0004 } }));
      },
    });
    const result = await client.complete(request);
    assert.deepEqual(result, { text: '{"a":1}', finishReason: null, microUsd: 400 });
    assert.equal(seen?.url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(seen?.init.body));
    assert.equal(body.model, 'm/x');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal('tools' in body, false);
    assert.equal('tool_choice' in body, false);
    assert.equal((seen?.init.headers as Record<string, string>).authorization, 'Bearer secret-key');
  });

  it('prices a call from token counts when the gateway reports no cost', async () => {
    const client = new OpenRouterClient({ apiKey: 'k', prices, fetch: respond({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }) });
    // 1000 × 1 + 500 × 2 micro-dollars.
    assert.equal((await client.complete(request)).microUsd, 2000);
  });

  it('asks for the configured reasoning effort and leaves the field out otherwise', async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }] }));
    };
    await new OpenRouterClient({ apiKey: 'k', prices, fetch: capture }).complete(request);
    const result = await new OpenRouterClient({ apiKey: 'k', prices, reasoningEffort: 'low', fetch: capture }).complete(request);
    assert.equal('reasoning' in bodies[0]!, false);
    assert.deepEqual(bodies[1]!.reasoning, { effort: 'low' });
    assert.equal(result.finishReason, 'stop');
  });

  it('explains an empty answer that used up the token budget on thinking', async () => {
    const client = new OpenRouterClient({
      apiKey: 'k',
      prices,
      fetch: respond({
        choices: [{ finish_reason: 'length', message: { content: null } }],
        usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } },
      }),
    });
    await assert.rejects(
      client.complete(request),
      (error: unknown) =>
        error instanceof ModelError &&
        error.kind === 'empty' &&
        error.message.includes('finish_reason length') &&
        error.message.includes('100 of 100 output tokens') &&
        error.message.includes('100 spent on reasoning'),
    );
  });

  it('turns a slow gateway into a timeout error', async () => {
    const client = new OpenRouterClient({
      apiKey: 'k',
      prices,
      fetch: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    await assert.rejects(client.complete(request), (error: unknown) => error instanceof ModelError && error.kind === 'timeout');
  });

  it('reports HTTP failures and empty answers without leaking the key', async () => {
    const failing = new OpenRouterClient({ apiKey: 'secret-key', prices, fetch: respond({ error: 'no' }, 429) });
    await assert.rejects(failing.complete(request), (error: unknown) => error instanceof ModelError && error.kind === 'http' && error.status === 429 && !error.message.includes('secret-key'));
    const empty = new OpenRouterClient({ apiKey: 'k', prices, fetch: respond({ choices: [] }) });
    await assert.rejects(empty.complete(request), (error: unknown) => error instanceof ModelError && error.kind === 'empty');
  });
});

describe('loadChatConfig', () => {
  it('needs nothing when chat is off', () => {
    assert.equal(loadChatConfig({}).enabled, false);
    assert.equal(loadChatConfig({ CHAT_ENABLED: 'false', OPENROUTER_API_KEY: 'x' }).enabled, false);
  });

  it('requires the key, a model, a budget and prices when chat is on', () => {
    const env = {
      CHAT_ENABLED: 'true',
      OPENROUTER_API_KEY: 'k',
      CHAT_MODEL_PRIMARY: 'a/b',
      CHAT_DAILY_BUDGET_USD: '5',
      CHAT_PRICE_INPUT_PER_MILLION_USD: '0.5',
      CHAT_PRICE_OUTPUT_PER_MILLION_USD: '1.5',
    };
    const config = loadChatConfig(env);
    assert.equal(config.primaryModel, 'a/b');
    assert.equal(config.fallbackModel, null);
    assert.equal(config.maxOutputTokens, 300);
    for (const name of Object.keys(env).filter((key) => key !== 'CHAT_ENABLED')) {
      const { [name]: _removed, ...rest } = env as Record<string, string>;
      assert.throws(() => loadChatConfig({ ...rest, CHAT_ENABLED: 'true' }), ChatConfigError, name);
    }
    assert.throws(() => loadChatConfig({ ...env, CHAT_DAILY_BUDGET_USD: '-1' }), ChatConfigError);
  });

  it('reads an optional reasoning effort and rejects unknown values', () => {
    const env = {
      CHAT_ENABLED: 'true',
      OPENROUTER_API_KEY: 'k',
      CHAT_MODEL_PRIMARY: 'a/b',
      CHAT_DAILY_BUDGET_USD: '5',
      CHAT_PRICE_INPUT_PER_MILLION_USD: '0.5',
      CHAT_PRICE_OUTPUT_PER_MILLION_USD: '1.5',
    };
    assert.equal(loadChatConfig(env).reasoningEffort, null);
    assert.equal(loadChatConfig({ ...env, CHAT_REASONING_EFFORT: ' Low ' }).reasoningEffort, 'low');
    assert.throws(() => loadChatConfig({ ...env, CHAT_REASONING_EFFORT: 'max' }), ChatConfigError);
  });
});
