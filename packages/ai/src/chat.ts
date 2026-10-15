import { type SpendLedger, estimateMicroUsd, usdToMicro } from './budget.js';
import type { ChatConfig } from './config.js';
import type { ConversationLock } from './lock.js';
import { CONSOLIDATE_AT, type MemoryStore, mergeCandidate } from './memory.js';
import { type CompletionResult, ModelError, type ModelClient } from './model.js';
import { MAX_OWNER_MESSAGE_CHARS, buildMessages } from './persona.js';
import { type QuotaStore, msUntilNextUtcDay, utcDay } from './quota.js';
import { parseReply, type CitizenReply } from './reply.js';
import {
  type ConversationStore,
  currentConversation,
  needsBreakReminder,
  withTurns,
} from './session.js';
import type { CitizenContext } from './types.js';

/** Why the model did not answer this time. The message is given back to the owner for every reason. */
export type UnavailableReason = 'disabled' | 'budget' | 'quota' | 'timeout' | 'invalid' | 'error' | 'busy';

export type ChatOutcome =
  | {
      readonly kind: 'reply';
      readonly reply: string;
      readonly emotion: CitizenReply['emotion'];
      readonly animation: CitizenReply['animation'];
      readonly remaining: number;
      readonly breakReminder: boolean;
    }
  | {
      /** The model refused the request as unsafe. The message still counts against the quota. */
      readonly kind: 'declined';
      readonly remaining: number;
      readonly breakReminder: boolean;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: UnavailableReason;
      readonly remaining: number;
      readonly breakReminder: boolean;
      /** Set when `reason` is `quota`: milliseconds until the UTC day rolls over. */
      readonly quotaResetsInMs?: number;
    }
  | { readonly kind: 'rejected'; readonly reason: 'empty' | 'too-long' };

/** What one call to a model came to. It never carries the owner's message or the reply text. */
export interface ModelCall {
  readonly model: string;
  readonly outcome: 'ok' | 'declined' | 'invalid' | 'timeout' | 'error';
  /** The HTTP status or failure kind for an error, the parse reason for a rejected answer. */
  readonly detail: string | null;
  readonly ms: number;
  /** Cost of the call in micro-dollars, when it got an answer. */
  readonly microUsd: number | null;
}

export interface ChatDeps {
  readonly config: ChatConfig;
  readonly dailyMessageLimit: number;
  readonly model: ModelClient;
  readonly quota: QuotaStore;
  readonly memory: MemoryStore;
  readonly conversations: ConversationStore;
  readonly ledger: SpendLedger;
  readonly lock: ConversationLock;
  /** Told about every model call, so an operator can see why owners get no answer. */
  readonly onModelCall?: (call: ModelCall) => void;
  /** Called when an owner's summary has grown long enough to be rewritten by the worker. */
  readonly onSummaryGrown?: (asset: string, owner: string) => void | Promise<void>;
  readonly now?: () => number;
}

export interface ChatRequest {
  readonly citizen: CitizenContext;
  /** The wallet the server verified as the current owner of the asset. */
  readonly owner: string;
  readonly message: string;
}

export interface ChatStatus {
  readonly enabled: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetsInMs: number;
  readonly breakReminder: boolean;
}

export interface ChatService {
  respond(request: ChatRequest): Promise<ChatOutcome>;
  status(asset: string, owner: string): Promise<ChatStatus>;
  /**
   * Wipes what the citizen keeps about this owner: the private notes and the
   * open conversation, which the model would otherwise still see. Returns
   * `false` when a message is being answered right now; try again after it.
   */
  forget(asset: string, owner: string): Promise<boolean>;
}

/**
 * One owner message in, one reply out (SPEC v2 section 10). The caller has
 * already verified the owner against the chain. This keeps the quota and the
 * budget honest, and when the model cannot answer it says so instead of
 * inventing a reply: the owner keeps the message.
 */
export function createChatService(deps: ChatDeps): ChatService {
  const now = deps.now ?? Date.now;
  const { config } = deps;
  const capMicroUsd = usdToMicro(config.dailyBudgetUsd);
  const models = [config.primaryModel, ...(config.fallbackModel ? [config.fallbackModel] : [])];
  const lockTtlMs = config.timeoutMs * models.length + 5_000;

  const left = (used: number): number => Math.max(deps.dailyMessageLimit - used, 0);

  async function respond(request: ChatRequest): Promise<ChatOutcome> {
    const text = request.message.trim();
    if (text === '') return { kind: 'rejected', reason: 'empty' };
    if ([...text].length > MAX_OWNER_MESSAGE_CHARS) return { kind: 'rejected', reason: 'too-long' };

    const { citizen, owner } = request;
    const at = now();
    const day = utcDay(at);
    const used = await deps.quota.used(citizen.asset, day);
    const base = (): { remaining: number; breakReminder: boolean } => ({ remaining: left(used), breakReminder: false });

    if (!config.enabled) return { kind: 'unavailable', reason: 'disabled', ...base() };

    const release = await deps.lock.acquire(`${citizen.asset}:${owner}`, lockTtlMs);
    if (!release) return { kind: 'unavailable', reason: 'busy', ...base() };
    try {
      return await converse(citizen, owner, text, at, day);
    } finally {
      await release();
    }
  }

  async function converse(citizen: CitizenContext, owner: string, text: string, at: number, day: string): Promise<ChatOutcome> {
    const previous = await deps.conversations.get(citizen.asset, owner);
    const conversation = currentConversation(previous, at);
    const breakReminder = needsBreakReminder(conversation, at);

    const taken = await deps.quota.consume(citizen.asset, day, deps.dailyMessageLimit);
    if (!taken.allowed) {
      return { kind: 'unavailable', reason: 'quota', remaining: 0, breakReminder, quotaResetsInMs: msUntilNextUtcDay(at) };
    }

    const memory = await deps.memory.privateMemory(citizen.asset, owner);
    const messages = buildMessages(
      citizen,
      {
        publicHistory: await deps.memory.publicHistory(citizen.asset),
        privateSummary: memory?.summary ?? null,
        nickname: memory?.nickname ?? null,
      },
      conversation.turns,
      text,
    );
    const estimate = estimateMicroUsd(messages, config.maxOutputTokens, config.prices);

    let failure: UnavailableReason = 'error';
    for (const model of models) {
      if (!(await deps.ledger.reserve(day, estimate, capMicroUsd))) {
        // Budget is gone. If an earlier model already failed, that failure is the more useful thing to report.
        if (model === config.primaryModel) failure = 'budget';
        break;
      }
      const startedAt = Date.now();
      const observe = (outcome: ModelCall['outcome'], detail: string | null, microUsd: number | null): void => {
        try {
          deps.onModelCall?.({ model, outcome, detail, ms: Date.now() - startedAt, microUsd });
        } catch {
          // A broken observer must never cost an owner their answer.
        }
      };
      let result: CompletionResult;
      try {
        result = await deps.model.complete({
          model,
          messages,
          maxTokens: config.maxOutputTokens,
          timeoutMs: config.timeoutMs,
        });
      } catch (error) {
        const timedOut = error instanceof ModelError && error.kind === 'timeout';
        // A timeout may still be billed, so its reservation stays. Other failures never reached the model.
        if (!timedOut) await deps.ledger.adjust(day, -estimate);
        failure = timedOut ? 'timeout' : 'error';
        observe(
          timedOut ? 'timeout' : 'error',
          error instanceof ModelError ? (error.status !== undefined ? `${error.kind} ${error.status}` : error.kind) : 'unexpected',
          null,
        );
        continue;
      }
      // The call is paid for whether or not the answer turns out to be usable.
      await deps.ledger.adjust(day, result.microUsd - estimate);

      const parsed = parseReply(result.text);
      if (!parsed.ok) {
        if (parsed.reason === 'blocked') {
          observe('declined', parsed.reason, result.microUsd);
          return { kind: 'declined', remaining: left(taken.used), breakReminder };
        }
        failure = 'invalid';
        observe('invalid', parsed.reason, result.microUsd);
        continue;
      }
      observe('ok', null, result.microUsd);
      const { reply } = parsed;
      await deps.conversations.put(
        citizen.asset,
        owner,
        withTurns(conversation, at, { from: 'owner', text }, { from: 'citizen', text: reply.reply }),
      );
      if (reply.memoryCandidate) {
        const merged = mergeCandidate(memory, reply.memoryCandidate, at);
        await deps.memory.savePrivateMemory(citizen.asset, owner, merged);
        if ((merged.summary?.length ?? 0) >= CONSOLIDATE_AT) {
          try {
            await deps.onSummaryGrown?.(citizen.asset, owner);
          } catch {
            // The rewrite is housekeeping; the answer is already paid for and must reach the owner.
          }
        }
      }
      return {
        kind: 'reply',
        reply: reply.reply,
        emotion: reply.emotion,
        animation: reply.animation,
        remaining: left(taken.used),
        breakReminder,
      };
    }

    // Nothing usable came back, so the owner keeps the message.
    await deps.quota.refund(citizen.asset, day);
    return { kind: 'unavailable', reason: failure, remaining: left(taken.used - 1), breakReminder };
  }

  async function status(asset: string, owner: string): Promise<ChatStatus> {
    const at = now();
    const used = await deps.quota.used(asset, utcDay(at));
    const conversation = currentConversation(await deps.conversations.get(asset, owner), at);
    return {
      enabled: config.enabled,
      limit: deps.dailyMessageLimit,
      remaining: left(used),
      resetsInMs: msUntilNextUtcDay(at),
      breakReminder: needsBreakReminder(conversation, at),
    };
  }

  async function forget(asset: string, owner: string): Promise<boolean> {
    // The same lock as a message, so an answer in flight cannot write the notes back afterwards.
    const release = await deps.lock.acquire(`${asset}:${owner}`, lockTtlMs);
    if (!release) return false;
    try {
      await deps.memory.deletePrivateMemory(asset, owner);
      await deps.conversations.delete(asset, owner);
      return true;
    } finally {
      await release();
    }
  }

  return { respond, status, forget };
}
