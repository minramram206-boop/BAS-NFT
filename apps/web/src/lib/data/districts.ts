import type { CitizenRecord, StatKey } from '@bas/content';
import { STAT_KEYS } from '@bas/content';
import { tierOf } from '@bas/chain-client/stats';
import type { BracketId, DistrictId } from './types';

/**
 * District rules from the design doc: which stats a district belongs to and
 * the score one of them must reach before a citizen may enter.
 */
export interface DistrictRule {
  readonly id: DistrictId;
  readonly stats: readonly StatKey[];
  /** 0 = open from mint; 3, 6, 10 = the Tier 1, 2, 3 thresholds. */
  readonly unlockScore: 0 | 3 | 6 | 10;
}

export const DISTRICT_RULES: Readonly<Record<DistrictId, DistrictRule>> = {
  plaza: { id: 'plaza', stats: STAT_KEYS, unlockScore: 0 },
  archive: { id: 'archive', stats: ['intelligence'], unlockScore: 0 },
  hearth: { id: 'hearth', stats: ['alignment'], unlockScore: 0 },
  forge: { id: 'forge', stats: ['compute'], unlockScore: 0 },
  watch: { id: 'watch', stats: ['alignment', 'compute'], unlockScore: 3 },
  frontier: { id: 'frontier', stats: ['intelligence', 'compute'], unlockScore: 6 },
  summit: { id: 'summit', stats: STAT_KEYS, unlockScore: 10 },
};

export const DISTRICT_ORDER: readonly DistrictId[] = [
  'plaza',
  'archive',
  'hearth',
  'forge',
  'watch',
  'frontier',
  'summit',
];

/** Districts that can be closed to a citizen, drawn with a lock overlay. */
export const LOCKABLE_DISTRICTS: readonly DistrictId[] = ['watch', 'frontier', 'summit'];

export function isDistrictOpen(citizen: CitizenRecord | undefined, id: DistrictId): boolean {
  const rule = DISTRICT_RULES[id];
  if (rule.unlockScore === 0) return true;
  if (!citizen) return false;
  return rule.stats.some((stat) => citizen[stat] >= rule.unlockScore);
}

/** The stat that opened a district for this citizen, for "unlocked by" copy. */
export function unlockingStat(citizen: CitizenRecord, id: DistrictId): StatKey | undefined {
  const rule = DISTRICT_RULES[id];
  return rule.stats.find((stat) => citizen[stat] >= rule.unlockScore);
}

export function highestStat(citizen: CitizenRecord): number {
  return Math.max(citizen.intelligence, citizen.alignment, citizen.compute);
}

/** Competition bracket by highest stat (PRIZE_POOL_MODEL §6). */
export function bracketOf(citizen: CitizenRecord): Exclude<BracketId, 'open'> {
  const highest = highestStat(citizen);
  if (highest >= 10) return 'master';
  if (highest >= 7) return 'elite';
  if (highest >= 4) return 'skilled';
  return 'rookie';
}

/** Highest tier across the three stats. */
export function topTier(citizen: CitizenRecord): { stat: StatKey; tier: 0 | 1 | 2 | 3 } {
  let best: { stat: StatKey; tier: 0 | 1 | 2 | 3 } = { stat: STAT_KEYS[0] as StatKey, tier: 0 };
  for (const stat of STAT_KEYS) {
    const tier = tierOf(citizen[stat]);
    if (tier > best.tier || (tier === best.tier && citizen[stat] > citizen[best.stat])) best = { stat, tier };
  }
  return best;
}
