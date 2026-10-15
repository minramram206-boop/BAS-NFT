import type { ModelMessage } from './persona.js';

export interface CompletionRequest {
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

export interface CompletionResult {
  readonly text: string;
  /** Why the model stopped, as the gateway reports it (`stop`, `length`, ...). */
  readonly finishReason?: string | null;
  /** What the call cost, in micro-dollars. */
  readonly microUsd: number;
}

export type ModelErrorKind = 'timeout' | 'network' | 'http' | 'empty';

export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly status: number | undefined;

  constructor(kind: ModelErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
    this.status = status;
  }
}

/** The one thing the chat service needs from a language model. */
export interface ModelClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** Prices in USD per million tokens, used when the gateway does not report the cost of a call. */
export interface TokenPrices {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
}

/** How much a reasoning model may think before it answers. `none` turns thinking off where the model allows it. */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface OpenRouterOptions {
  readonly apiKey: string;
  readonly prices: TokenPrices;
  /**
   * Sent as `reasoning.effort`. Reasoning models spend part of `max_tokens` on
   * thinking, so a small output cap can leave no room for the answer. Leave it
   * unset for models that do not reason: some gateways turn thinking on when
   * the field is present.
   */
  readonly reasoningEffort?: ReasoningEffort | null;
  readonly baseUrl?: string;
  /** Sent as `HTTP-Referer`, so the gateway can attribute traffic to the site. */
  readonly siteUrl?: string;
  readonly fetch?: typeof fetch;
}

interface ChatCompletionBody {
  readonly choices?: readonly {
    readonly finish_reason?: unknown;
    readonly message?: { readonly content?: unknown };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
    readonly cost?: number;
  };
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter chat completions, called from the server only. The request never
 * carries `tools` or `tool_choice`: tool calling is off in v1.5 (SPEC v2
 * section 10.5). The API key stays inside this object and is never put in an
 * error message.
 */
export class OpenRouterClient implements ModelClient {
  private readonly options: OpenRouterOptions;

  constructor(options: OpenRouterOptions) {
    this.options = options;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const doFetch = this.options.fetch ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${this.options.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          'x-title': 'BAS District',
          ...(this.options.siteUrl ? { 'http-referer': this.options.siteUrl } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens,
          temperature: 0.8,
          response_format: { type: 'json_object' },
          usage: { include: true },
          ...(this.options.reasoningEffort ? { reasoning: { effort: this.options.reasoningEffort } } : {}),
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) throw new ModelError('timeout', 'The model did not answer in time.');
      throw new ModelError('network', error instanceof Error ? error.name : 'Network error.');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new ModelError('http', `The gateway answered ${response.status}.`, response.status);

    let body: ChatCompletionBody;
    try {
      body = (await response.json()) as ChatCompletionBody;
    } catch {
      throw new ModelError('empty', 'The gateway answer was not JSON.');
    }
    const choice = body.choices?.[0];
    const text = choice?.message?.content;
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new ModelError('empty', `The model returned no text (${describeStop(finishReason, body.usage, request.maxTokens)}).`);
    }
    return { text, finishReason, microUsd: this.cost(body.usage) };
  }

  private cost(usage: ChatCompletionBody['usage']): number {
    if (typeof usage?.cost === 'number' && usage.cost >= 0) return Math.ceil(usage.cost * 1_000_000);
    const { inputPerMillionUsd, outputPerMillionUsd } = this.options.prices;
    // Micro-dollars = tokens × (USD per million tokens), because 1e6 tokens × price USD / 1e6 × 1e6.
    return Math.ceil((usage?.prompt_tokens ?? 0) * inputPerMillionUsd + (usage?.completion_tokens ?? 0) * outputPerMillionUsd);
  }
}

/** A short account of a call that ended without text, for logs and the smoke script. */
function describeStop(finishReason: string | null, usage: ChatCompletionBody['usage'], maxTokens: number): string {
  const parts = [`finish_reason ${finishReason ?? 'unknown'}`];
  const used = usage?.completion_tokens;
  if (typeof used === 'number') parts.push(`${used} of ${maxTokens} output tokens used`);
  const thinking = usage?.completion_tokens_details?.reasoning_tokens;
  if (typeof thinking === 'number' && thinking > 0) parts.push(`${thinking} spent on reasoning`);
  return parts.join(', ');
}
