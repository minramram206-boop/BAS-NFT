import { REASONING_EFFORTS } from './model.js';
import type { ReasoningEffort, TokenPrices } from './model.js';

export interface ChatConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  /** Null leaves the field out of the request. */
  readonly reasoningEffort: ReasoningEffort | null;
  readonly dailyBudgetUsd: number;
  readonly prices: TokenPrices;
}

export class ChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function positive(env: Env, name: string, fallback?: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new ChatConfigError(`${name} is required when chat is enabled.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ChatConfigError(`${name} must be a positive number.`);
  return value;
}

function reasoningEffort(env: Env): ReasoningEffort | null {
  const raw = env.CHAT_REASONING_EFFORT?.trim().toLowerCase();
  if (!raw) return null;
  const match = REASONING_EFFORTS.find((effort) => effort === raw);
  if (!match) throw new ChatConfigError(`CHAT_REASONING_EFFORT must be one of: ${REASONING_EFFORTS.join(', ')}.`);
  return match;
}

/**
 * Reads the CHAT_* settings (SPEC v2 section 10.1). Model names come only from
 * here, never from source. With `CHAT_ENABLED` off or unset nothing else is
 * required and chat reports itself unavailable.
 */
export function loadChatConfig(env: Env): ChatConfig {
  const enabled = env.CHAT_ENABLED?.trim().toLowerCase() === 'true';
  if (!enabled) {
    return {
      enabled: false,
      apiKey: '',
      primaryModel: '',
      fallbackModel: null,
      maxOutputTokens: 300,
      timeoutMs: 12_000,
      reasoningEffort: null,
      dailyBudgetUsd: 0,
      prices: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    };
  }
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? '';
  if (!apiKey) throw new ChatConfigError('OPENROUTER_API_KEY is required when chat is enabled.');
  const primaryModel = env.CHAT_MODEL_PRIMARY?.trim() ?? '';
  if (!primaryModel) throw new ChatConfigError('CHAT_MODEL_PRIMARY is required when chat is enabled.');
  return {
    enabled: true,
    apiKey,
    primaryModel,
    fallbackModel: env.CHAT_MODEL_FALLBACK?.trim() || null,
    maxOutputTokens: Math.trunc(positive(env, 'CHAT_MAX_OUTPUT_TOKENS', 300)),
    timeoutMs: Math.trunc(positive(env, 'CHAT_REQUEST_TIMEOUT_MS', 12_000)),
    reasoningEffort: reasoningEffort(env),
    dailyBudgetUsd: positive(env, 'CHAT_DAILY_BUDGET_USD'),
    // Only used when the gateway does not report what a call cost.
    prices: {
      inputPerMillionUsd: positive(env, 'CHAT_PRICE_INPUT_PER_MILLION_USD'),
      outputPerMillionUsd: positive(env, 'CHAT_PRICE_OUTPUT_PER_MILLION_USD'),
    },
  };
}
