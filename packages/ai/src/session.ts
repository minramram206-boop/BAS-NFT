import type { ChatTurn } from './types.js';

/** A gap this long ends a conversation; the next message starts a new one. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** The break reminder (SPEC v2 section 9). Tokens cannot buy it away. */
export const SESSION_REMINDER_MS = 60 * 60 * 1000;
/** Turns kept per conversation; the model sees only the last few. */
const MAX_KEPT_TURNS = 12;

export interface Conversation {
  readonly startedAt: number;
  readonly lastAt: number;
  readonly turns: readonly ChatTurn[];
}

/**
 * Short-lived conversation state, held by the server so a client cannot invent
 * earlier turns. It is not a transcript archive: it expires with the idle gap.
 */
export interface ConversationStore {
  get(asset: string, owner: string): Promise<Conversation | null>;
  put(asset: string, owner: string, conversation: Conversation): Promise<void>;
  /** Drops the open conversation, so the next message starts from nothing. */
  delete(asset: string, owner: string): Promise<void>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly records = new Map<string, Conversation>();

  async get(asset: string, owner: string): Promise<Conversation | null> {
    return this.records.get(`${asset}:${owner}`) ?? null;
  }

  async put(asset: string, owner: string, conversation: Conversation): Promise<void> {
    this.records.set(`${asset}:${owner}`, conversation);
  }

  async delete(asset: string, owner: string): Promise<void> {
    this.records.delete(`${asset}:${owner}`);
  }
}

/** The conversation a message at `now` belongs to: the open one, or a fresh one after an idle gap. */
export function currentConversation(previous: Conversation | null, now: number): Conversation {
  if (previous && now - previous.lastAt < SESSION_IDLE_MS) return previous;
  return { startedAt: now, lastAt: now, turns: [] };
}

export function withTurns(conversation: Conversation, now: number, ...turns: ChatTurn[]): Conversation {
  return { ...conversation, lastAt: now, turns: [...conversation.turns, ...turns].slice(-MAX_KEPT_TURNS) };
}

export function needsBreakReminder(conversation: Conversation, now: number): boolean {
  return now - conversation.startedAt >= SESSION_REMINDER_MS;
}
