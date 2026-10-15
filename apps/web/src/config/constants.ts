import { MAX_STAT_SCORE, STAT_KEYS } from '@bas/content';
import type { StatKey } from '@bas/content';

/**
 * Presentation constants for the BAS District UI. Public copy lives only in
 * `src/messages/en.json`; values mirroring the program are checked by the
 * `@bas/chain-client` tests.
 */

export { MAX_STAT_SCORE };

/** Trainable stats in display order. */
export const STAT_ORDER: readonly StatKey[] = STAT_KEYS;

/** Scores where a stat reaches Tier 1, 2 and 3. */
export const TIER_SCORES = [3, 6, 10] as const;

/** One color family per stat, used for bars, chips and accents. */
export const STAT_COLORS: Readonly<Record<StatKey, { fill: string; light: string; soft: string }>> = {
  intelligence: { fill: '#3b74a6', light: '#8fbfee', soft: '#e3eef8' },
  alignment: { fill: '#3f9252', light: '#8fdc9b', soft: '#e4f3e7' },
  compute: { fill: '#8c579c', light: '#d3a8e0', soft: '#f3e8f6' },
};
