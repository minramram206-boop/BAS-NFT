/** The UTC calendar day of a unix-millisecond time, as `YYYY-MM-DD`. The quota resets when it changes. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight, for telling the owner when the quota returns. */
export function msUntilNextUtcDay(nowMs: number): number {
  const date = new Date(nowMs);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return next - nowMs;
}

/**
 * Counts free-form messages per asset per UTC day (SPEC v2 section 11.4). The
 * key is the asset, so a transfer does not reset it. Implementations must make
 * `consume` atomic: two concurrent calls may never both take the last message.
 */
export interface QuotaStore {
  /** Takes one message if the asset is under `limit` today. */
  consume(asset: string, day: string, limit: number): Promise<{ readonly allowed: boolean; readonly used: number }>;
  /** Gives one back, for a message that never reached the model. */
  refund(asset: string, day: string): Promise<void>;
  used(asset: string, day: string): Promise<number>;
}

export class InMemoryQuotaStore implements QuotaStore {
  private readonly counts = new Map<string, number>();

  private key(asset: string, day: string): string {
    return `${asset}:${day}`;
  }

  async consume(asset: string, day: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const key = this.key(asset, day);
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) return { allowed: false, used };
    this.counts.set(key, used + 1);
    return { allowed: true, used: used + 1 };
  }

  async refund(asset: string, day: string): Promise<void> {
    const key = this.key(asset, day);
    const used = this.counts.get(key) ?? 0;
    if (used > 0) this.counts.set(key, used - 1);
  }

  async used(asset: string, day: string): Promise<number> {
    return this.counts.get(this.key(asset, day)) ?? 0;
  }
}
