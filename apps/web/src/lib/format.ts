import type { StatKey } from '@bas/content';
import { formatTokenAtoms } from '@bas/chain-client/stats';
import { DISTRICT_RULES } from '@/lib/data/districts';
import type { DistrictId } from '@/lib/data/types';
import { MESSAGES, formatMessage } from '@/messages';

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Token atoms as a grouped English number, e.g. `1,240` or `0.5`. */
export function formatTokens(atoms: bigint, decimals: number): string {
  const [whole = '0', fraction] = formatTokenAtoms(atoms, decimals).split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatSol(lamports: bigint, digits = 2): string {
  return `${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(digits)} SOL`;
}

/** `52` hours as `2d 04h`. */
export function formatHours(hours: number): string {
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return days > 0 ? `${days}d ${String(rest).padStart(2, '0')}h` : `${rest}h`;
}

export function statLabel(stat: StatKey): string {
  return MESSAGES.stats[stat].label;
}

/** "Insight or Craft" for the stats that open a district. */
export function statList(stats: readonly StatKey[]): string {
  return stats.length === 3 ? MESSAGES.districts.anyStat : stats.map(statLabel).join(MESSAGES.districts.or);
}

export function tierForScore(score: number): number {
  return score >= 10 ? 3 : score >= 6 ? 2 : score >= 3 ? 1 : 0;
}

export function districtName(id: DistrictId | 'road' | undefined): string {
  return id ? MESSAGES.districts[id] : MESSAGES.districts.road;
}

/** Long lock rule, e.g. "Tier 2 · Insight or Craft 6". */
export function lockedRule(id: DistrictId): string {
  const rule = DISTRICT_RULES[id];
  return formatMessage(MESSAGES.districts.lockedRule, {
    tier: tierForScore(rule.unlockScore),
    stats: statList(rule.stats),
    score: rule.unlockScore,
  });
}
