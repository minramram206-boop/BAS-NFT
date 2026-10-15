import {
  InMemoryConversationStore,
  InMemoryLock,
  InMemoryMemoryStore,
  InMemoryQuotaStore,
  InMemorySpendLedger,
  type ChatConfig,
  type CitizenContext,
  type CompletionRequest,
  type CompletionResult,
  type ModelClient,
} from '../dist/index.js';

export const ASSET = 'Asset1111111111111111111111111111111111111';
export const OWNER = 'Owner1111111111111111111111111111111111111';
export const BUYER = 'Buyer1111111111111111111111111111111111111';

export const CITIZEN: CitizenContext = {
  asset: ASSET,
  name: 'Ivy',
  roleKey: 'steward',
  role: 'Steward',
  lore: 'Keeps the hearth lamps lit in Hearth Row.',
  scores: { intelligence: 1, alignment: 2, compute: 0 },
};

export const CONFIG: ChatConfig = {
  enabled: true,
  apiKey: 'test-key',
  primaryModel: 'primary/model',
  fallbackModel: 'fallback/model',
  maxOutputTokens: 300,
  timeoutMs: 5_000,
  reasoningEffort: null,
  dailyBudgetUsd: 1,
  prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
};

export const goodReply = (reply = 'The lamps along Hearth Row are lit.') =>
  JSON.stringify({ reply, emotion: 'happy', animation: 'happy', memoryCandidate: null, safety: 'ok' });

/** A model that plays back a script of answers and records what it was asked. */
export class ScriptedModel implements ModelClient {
  readonly requests: CompletionRequest[] = [];
  private index = 0;

  private readonly script: readonly (CompletionResult | Error)[];

  constructor(script: readonly (CompletionResult | Error)[]) {
    this.script = script;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const step = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (!step) throw new Error('empty script');
    if (step instanceof Error) throw step;
    return step;
  }
}

export function setup(model: ModelClient, overrides: { now?: () => number; limit?: number; config?: Partial<ChatConfig> } = {}) {
  const quota = new InMemoryQuotaStore();
  const memory = new InMemoryMemoryStore();
  const conversations = new InMemoryConversationStore();
  const ledger = new InMemorySpendLedger();
  const base = {
    config: { ...CONFIG, ...overrides.config },
    dailyMessageLimit: overrides.limit ?? 20,
    model,
    quota,
    memory,
    conversations,
    ledger,
    lock: new InMemoryLock(),
  };
  return { quota, memory, conversations, ledger, deps: overrides.now ? { ...base, now: overrides.now } : base };
}
