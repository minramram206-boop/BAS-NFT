import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';

import {
  InMemoryConversationStore,
  InMemoryLock,
  InMemoryMemoryStore,
  InMemoryQuotaStore,
  InMemorySpendLedger,
  createChatService,
  type ChatConfig,
  type CompletionRequest,
  type CompletionResult,
  type ModelClient,
} from '@bas/ai';
import { createChatServer, createCitizenDirectory } from '@bas/chat-server';
import { loadCitizens } from '@bas/content/server';
import { Authenticator, MemoryStore, MissionService, createMissionServer } from '@bas/mission-server';
import { Keypair } from '@solana/web3.js';

import { createChainDataSource } from '../src/lib/data/chain/chainDataSource.ts';
import { createTransactions } from '../src/lib/data/chain/transactions.ts';
import type { ChainDataSource } from '../src/lib/data/chain/types.ts';
import { ChatPortError } from '../src/lib/data/chat.ts';
import { BASE_COST, PROGRAM_ID, SEASON_START, UTILITY_MINT, World, testWallet, type TestWallet } from './chainWorld.ts';

const roster = loadCitizens();
const [A, B] = roster.map((citizen) => citizen.id) as [number, number];
const NOW = (SEASON_START + 3_600) * 1000;
const SECRET = Buffer.alloc(32, 9);

const CONFIG: ChatConfig = {
  enabled: true,
  apiKey: 'k',
  primaryModel: 'primary/model',
  fallbackModel: null,
  maxOutputTokens: 300,
  timeoutMs: 2_000,
  reasoningEffort: null,
  dailyBudgetUsd: 1,
  prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
};

const answer = (reply: string, memoryCandidate: string | null = null) =>
  JSON.stringify({ reply, emotion: 'happy', animation: 'happy', memoryCandidate, safety: 'ok' });

class ScriptedModel implements ModelClient {
  readonly requests: CompletionRequest[] = [];

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    return { text: answer(`Answer ${this.requests.length}.`, this.requests.length === 1 ? 'Likes to be called Boss' : null), microUsd: 500 };
  }
}

interface Rig {
  world: World;
  source: ChainDataSource;
  owner: TestWallet;
  stranger: TestWallet;
  asset: { a: string; b: string };
  model: ScriptedModel;
  network: { chatDown: boolean };
  close: () => Promise<void>;
}

async function rig(options: { limit?: number; config?: Partial<ChatConfig> } = {}): Promise<Rig> {
  const world = new World(roster, () => Math.floor(NOW / 1000));
  const owner = testWallet();
  const stranger = testWallet();
  const asset = {
    a: world.add(A, owner.address, [1, 2, 0], [0, 0, 0]),
    b: world.add(B, stranger.address, [2, 2, 2], [0, 0, 0]),
  };
  world.tokens.set(owner.address, 2_000_000_000n);
  world.sol.set(owner.address, 3_000_000_000n);

  const missionServer = createMissionServer({
    service: new MissionService({
      programId: PROGRAM_ID,
      authority: Keypair.generate(),
      season: { id: 1, startsAt: SEASON_START, days: 28 },
      store: new MemoryStore(),
      chain: world,
      clock: () => NOW,
    }),
    auth: new Authenticator(SECRET, () => NOW),
    allowedOrigins: [],
    rateLimit: 100_000,
  });

  const model = new ScriptedModel();
  const memory = new InMemoryMemoryStore();
  const chatServer = createChatServer({
    chat: createChatService({
      config: { ...CONFIG, ...options.config },
      dailyMessageLimit: options.limit ?? 20,
      model,
      quota: new InMemoryQuotaStore(),
      memory,
      conversations: new InMemoryConversationStore(),
      ledger: new InMemorySpendLedger(),
      lock: new InMemoryLock(),
      now: () => NOW,
    }),
    directory: createCitizenDirectory(world, roster),
    memory,
    tokenSecret: SECRET,
    allowedOrigins: [],
    clock: () => NOW,
    rateLimit: 100_000,
  });
  await Promise.all([
    new Promise<void>((resolve) => missionServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => chatServer.listen(0, '127.0.0.1', resolve)),
  ]);
  const url = (server: typeof missionServer) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const network = { chatDown: false };

  const source = createChainDataSource({
    roster,
    reads: world,
    transactions: createTransactions({
      rpc: world.sendRpc(),
      programId: PROGRAM_ID.toBase58(),
      utilityMint: UTILITY_MINT,
      sleep: async () => {},
    }),
    missionApi: { baseUrl: url(missionServer) },
    chatApi: {
      baseUrl: url(chatServer),
      fetch: (async (...args: Parameters<typeof fetch>) => {
        if (network.chatDown) throw new TypeError('fetch failed');
        return fetch(...args);
      }) as typeof fetch,
    },
    baseTrainingCostAtoms: BASE_COST.toString(),
    mintPriceLamports: '10000000',
    mintLimitPerWallet: 1,
    maxSupply: 100,
    clock: () => NOW,
    sleep: async () => {},
  });
  return {
    world,
    source,
    owner,
    stranger,
    asset,
    model,
    network,
    close: () => Promise.all([missionServer, chatServer].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))).then(() => undefined),
  };
}

async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ChatPortError) return error.code;
    throw error;
  }
  return 'none';
}

describe('talking to a citizen through the chain data source', () => {
  const open: Rig[] = [];
  const make = async (options?: Parameters<typeof rig>[0]) => {
    const r = await rig(options);
    open.push(r);
    return r;
  };
  after(async () => {
    await Promise.all(open.map((r) => r.close()));
  });

  it('lets the owner talk, signing in once for missions and chat together', async () => {
    const r = await make();
    await r.source.setWallet(r.owner);
    const chat = r.source.chat;
    assert.ok(chat);
    const status = await chat.status(A);
    assert.equal(status.enabled, true);
    assert.equal(status.remaining, 20);

    const first = await chat.send(A, 'Hello');
    assert.equal(first.kind, 'reply');
    assert.equal(first.kind === 'reply' && first.reply, 'Answer 1.');
    assert.equal(first.remaining, 19);

    // The citizen is addressed by the name in the roster, found through the metadata number.
    const prompt = r.model.requests[0]?.messages[0]?.content ?? '';
    assert.ok(prompt.includes(`You are ${roster.find((c) => c.id === A)?.name}`));
    assert.equal(r.owner.prompts.message, 1);
  });

  it('refuses a citizen the wallet does not hold, and a missing wallet, without a request', async () => {
    const r = await make();
    const chat = r.source.chat;
    assert.ok(chat);
    assert.equal(await failure(chat.status(A)), 'not-connected');
    await r.source.setWallet(r.owner);
    assert.equal(await failure(chat.send(B, 'Hi')), 'not-owner');
    assert.equal(r.model.requests.length, 0);
  });

  it('says so when the person closes the sign-in prompt', async () => {
    const r = await make();
    r.owner.declineMessages = true;
    await r.source.setWallet(r.owner);
    assert.equal(await failure(r.source.chat!.status(A)), 'declined');
  });

  it('is told no by the server once the citizen has been sold, even before the page notices', async () => {
    const r = await make();
    await r.source.setWallet(r.owner);
    assert.equal((await r.source.chat!.send(A, 'Hi')).kind, 'reply');
    r.world.transfer(r.asset.a, r.stranger.address);
    assert.equal(await failure(r.source.chat!.send(A, 'Hi again')), 'not-owner');
  });

  it('reports a chat server that cannot be reached', async () => {
    const r = await make();
    await r.source.setWallet(r.owner);
    r.network.chatDown = true;
    assert.equal(await failure(r.source.chat!.status(A)), 'unavailable');
    r.network.chatDown = false;
    assert.equal((await r.source.chat!.status(A)).enabled, true);
  });

  it('passes on the quota limit and the switched-off state', async () => {
    const limited = await make({ limit: 1 });
    await limited.source.setWallet(limited.owner);
    await limited.source.chat!.send(A, 'One');
    const second = await limited.source.chat!.send(A, 'Two');
    assert.equal(second.kind, 'unavailable');
    assert.equal(second.kind === 'unavailable' && second.reason, 'quota');
    assert.ok(second.kind === 'unavailable' && (second.quotaResetsInMs ?? 0) > 0);

    const off = await make({ config: { enabled: false } });
    await off.source.setWallet(off.owner);
    assert.equal((await off.source.chat!.status(A)).enabled, false);
    const sent = await off.source.chat!.send(A, 'Hi');
    assert.equal(sent.kind === 'unavailable' && sent.reason, 'disabled');
  });

  it('shows what the citizen remembers about this wallet and forgets it on request', async () => {
    const r = await make();
    await r.source.setWallet(r.owner);
    await r.source.chat!.send(A, 'Call me Boss');
    const remembered = await r.source.chat!.memory(A);
    assert.equal(remembered.nickname, 'Boss');
    await r.source.chat!.forget(A);
    const forgotten = await r.source.chat!.memory(A);
    assert.deepEqual([forgotten.nickname, forgotten.summary], [null, null]);
  });

  it('rejects an empty or over-long message with the server code', async () => {
    const r = await make();
    await r.source.setWallet(r.owner);
    assert.equal(await failure(r.source.chat!.send(A, '   ')), 'empty');
    assert.equal(await failure(r.source.chat!.send(A, 'x'.repeat(301))), 'too-long');
  });
});
