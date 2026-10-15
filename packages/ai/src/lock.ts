/**
 * Keeps one owner's messages to one citizen in order. Without it two messages
 * sent at once would both read the same conversation and memory, and one of the
 * two would be lost when they write back.
 */
export interface ConversationLock {
  /** A function that releases the lock, or `null` when someone else holds it. */
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

export class InMemoryLock implements ConversationLock {
  private readonly held = new Map<string, number>();

  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  async acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const now = this.clock();
    const until = this.held.get(key);
    if (until !== undefined && until > now) return null;
    const mine = now + ttlMs;
    this.held.set(key, mine);
    return async () => {
      if (this.held.get(key) === mine) this.held.delete(key);
    };
  }
}
