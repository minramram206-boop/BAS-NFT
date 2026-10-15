import {
  type ChatConfig,
  InMemoryConversationStore,
  InMemoryLock,
  InMemoryMemoryStore,
  InMemoryQuotaStore,
  InMemorySpendLedger,
  type ModelClient,
  createChatService,
} from '@bas/ai';
import type { CitizenRecord } from '@bas/content';
import { type AssetInfo, type CitizenAssets, type CitizenOnChain, issueBearerToken } from '@bas/server-kit';
import { Keypair } from '@solana/web3.js';
import { createCitizenDirectory, createChatServer } from '../dist/index.js';

export const SECRET = Buffer.alloc(32, 3);
export const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);

export const wallet = (): string => Keypair.generate().publicKey.toBase58();
export const tokenFor = (who: string): string => issueBearerToken(SECRET, who, NOW + 3_600_000);

export const CONFIG: ChatConfig = {
  enabled: true,
  apiKey: 'test-key',
  primaryModel: 'primary/model',
  fallbackModel: null,
  maxOutputTokens: 300,
  timeoutMs: 2_000,
  reasoningEffort: null,
  dailyBudgetUsd: 1,
  prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
};

export const ROSTER: CitizenRecord[] = [
  {
    id: 19,
    name: 'Ivy',
    code: '#019',
    role: 'Steward',
    roleKey: 'steward',
    image: '/characters/19.png',
    avatar: '/avatars/19.png',
    sprite: '/sprites/citizens/19.png',
    intelligence: 1,
    alignment: 2,
    compute: 0,
    registered: true,
    lore: 'Keeps the hearth lamps lit in Hearth Row.',
  },
];

export class FakeChain implements CitizenAssets {
  readonly owners = new Map<string, string>();
  readonly serials = new Map<string, number | null>();
  readonly citizens = new Map<string, CitizenOnChain>();

  async assetInfo(asset: string): Promise<AssetInfo | null> {
    const owner = this.owners.get(asset);
    return owner ? { owner, serial: this.serials.get(asset) ?? null } : null;
  }

  async citizen(asset: string): Promise<CitizenOnChain | null> {
    return this.citizens.get(asset) ?? null;
  }

  /** The roster number is 19 (Ivy); the on-chain registration count is deliberately different. */
  register(asset: string, owner: string): void {
    this.owners.set(asset, owner);
    this.serials.set(asset, 19);
    this.citizens.set(asset, { citizenId: 3, role: 1, scores: { intelligence: 1, alignment: 2, compute: 0 } });
  }
}

export function goodReply(reply = 'The lamps along Hearth Row are lit.', memoryCandidate: string | null = null): string {
  return JSON.stringify({ reply, emotion: 'happy', animation: 'happy', memoryCandidate, safety: 'ok' });
}

export function build(model: ModelClient, overrides: { config?: Partial<ChatConfig>; limit?: number; rateLimit?: number } = {}) {
  const chain = new FakeChain();
  const memory = new InMemoryMemoryStore();
  const quota = new InMemoryQuotaStore();
  const ledger = new InMemorySpendLedger();
  const directory = createCitizenDirectory(chain, ROSTER);
  const chat = createChatService({
    config: { ...CONFIG, ...overrides.config },
    dailyMessageLimit: overrides.limit ?? 20,
    model,
    quota,
    memory,
    conversations: new InMemoryConversationStore(),
    ledger,
    lock: new InMemoryLock(),
    now: () => NOW,
  });
  const server = createChatServer({
    chat,
    directory,
    memory,
    tokenSecret: SECRET,
    allowedOrigins: ['http://localhost:3000'],
    clock: () => NOW,
    ...(overrides.rateLimit === undefined ? {} : { rateLimit: overrides.rateLimit }),
  });
  return { chain, memory, quota, ledger, server };
}
