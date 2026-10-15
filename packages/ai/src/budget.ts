import type { TokenPrices } from './model.js';
import type { ModelMessage } from './persona.js';
import { utcDay } from './quota.js';

/**
 * Money spent on the model today, in micro-dollars so sums stay exact. It is the
 * kill switch of SPEC v2 section 10.1: once the day's budget is gone the model
 * is not called again until the UTC day changes.
 *
 * `reserve` is how a call gets permission. It adds a worst-case estimate in one
 * atomic step, so concurrent requests cannot each pass a separate check and
 * together overshoot the cap. `adjust` then corrects the estimate to the real
 * cost.
 */
export interface SpendLedger {
  spentMicroUsd(day: string): Promise<number>;
  /** Adds `microUsd` to the day only if the total stays at or under `capMicroUsd`. */
  reserve(day: string, microUsd: number, capMicroUsd: number): Promise<boolean>;
  /** Moves the day's total by `deltaMicroUsd`, which may be negative. */
  adjust(day: string, deltaMicroUsd: number): Promise<void>;
}

export class InMemorySpendLedger implements SpendLedger {
  private readonly days = new Map<string, number>();

  async spentMicroUsd(day: string): Promise<number> {
    return this.days.get(day) ?? 0;
  }

  async reserve(day: string, microUsd: number, capMicroUsd: number): Promise<boolean> {
    const spent = this.days.get(day) ?? 0;
    if (spent + microUsd > capMicroUsd) return false;
    this.days.set(day, spent + microUsd);
    return true;
  }

  async adjust(day: string, deltaMicroUsd: number): Promise<void> {
    this.days.set(day, Math.max((this.days.get(day) ?? 0) + deltaMicroUsd, 0));
  }
}

export const usdToMicro = (usd: number): number => Math.round(usd * 1_000_000);

/** Rough token count of a text. Deliberately high so the estimate errs on the side of the budget. */
const CHARS_PER_TOKEN = 3;

/**
 * The most a call can cost: every input character at a pessimistic token size
 * plus a full `maxOutputTokens` of output. A price per million tokens is the
 * same number as micro-dollars per token.
 */
export function estimateMicroUsd(messages: readonly ModelMessage[], maxOutputTokens: number, prices: TokenPrices): number {
  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
  return Math.ceil(inputTokens * prices.inputPerMillionUsd + maxOutputTokens * prices.outputPerMillionUsd);
}

/** True while there is budget left today. A budget of zero or less keeps the switch closed. */
export async function budgetAvailable(ledger: SpendLedger, dailyBudgetUsd: number, nowMs: number): Promise<boolean> {
  return (await ledger.spentMicroUsd(utcDay(nowMs))) < usdToMicro(dailyBudgetUsd);
}
