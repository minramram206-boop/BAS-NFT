import {
  ROLE_TEMPLATES,
  STAT_MAX,
  TIER_1_SCORE,
  TIER_2_SCORE,
  TIER_3_SCORE,
} from './constants.js';
import type { CitizenStateOnChain, RoleIndex, RoleTemplate, StatType } from './types.js';

/** Clamp a raw stat score into the protocol range (SPEC v2 §7). */
export function clampStatScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(STAT_MAX, Math.max(0, Math.trunc(score)));
}

/**
 * Visual tier of a score (SPEC v2 §7).
 *
 * Tier 3 is reached at 10. It is earned only by completing authorized missions,
 * because each score upgrade also requires a stat-specific Training Credit.
 */
export function tierOf(score: number): 0 | 1 | 2 | 3 {
  const value = clampStatScore(score);
  if (value >= TIER_3_SCORE) return 3;
  if (value >= TIER_2_SCORE) return 2;
  if (value >= TIER_1_SCORE) return 1;
  return 0;
}

/**
 * Cost of one upgrade in token atoms (SPEC v2 §5.3).
 *
 * `training_cost = base_training_cost × (current_score + 1)`.
 *
 * Inputs and output are `bigint`, never floating point. A raw u64 can exceed
 * `Number.MAX_SAFE_INTEGER`, and silently rounding it here would mean asking a
 * wallet to approve a different amount from the one the program burns.
 *
 * Pass a decimal string from `config/*.json` or a `bigint` read from the
 * on-chain config. A score already at the maximum costs zero because no upgrade
 * can be performed.
 */
export function trainingCostAtoms(baseTrainingCostAtoms: string | bigint, currentScore: number): bigint {
  let base: bigint;
  try {
    base = typeof baseTrainingCostAtoms === 'bigint'
      ? baseTrainingCostAtoms
      : BigInt(baseTrainingCostAtoms);
  } catch {
    throw new Error('[@bas/chain-client] baseTrainingCostAtoms must be a decimal integer');
  }
  if (base <= 0n) {
    throw new Error('[@bas/chain-client] baseTrainingCostAtoms must be positive');
  }
  const score = clampStatScore(currentScore);
  if (score >= STAT_MAX) return 0n;
  return base * BigInt(score + 1);
}

/**
 * Format token atoms for the public UI without converting through `number`.
 * Trailing fractional zeroes are omitted; for example, 2000000 atoms at 6
 * decimals is "2", not "2.000000".
 */
export function formatTokenAtoms(atoms: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('[@bas/chain-client] token decimals must be an integer from 0 to 18');
  }
  const negative = atoms < 0n;
  const absolute = negative ? -atoms : atoms;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  if (decimals === 0) return `${negative ? '-' : ''}${whole}`;
  const fractional = (absolute % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fractional ? `.${fractional}` : ''}`;
}

/** Whether one more upgrade of `currentScore` is possible at all. */
export function canUpgrade(currentScore: number): boolean {
  return clampStatScore(currentScore) < STAT_MAX;
}

/** Starting stats of a Phase A role (SPEC v2 §6.5). */
export function roleTemplate(index: RoleIndex): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((role) => role.index === index);
}

/** Every role key, in registry order. Handy for validating authored content. */
export function roleKeys(): readonly string[] {
  return ROLE_TEMPLATES.map((role) => role.key);
}

/**
 * Stat field of the on-chain record that holds this stat's credits.
 *
 * Three pools, not one balance (§5.3): a credit claimed for Insight cannot pay
 * for a Craft upgrade.
 */
export function creditFieldOf(
  stat: StatType,
): keyof Pick<CitizenStateOnChain, 'insightTrainingCredits' | 'bondTrainingCredits' | 'craftTrainingCredits'> {
  switch (stat) {
    case 'intelligence':
      return 'insightTrainingCredits';
    case 'alignment':
      return 'bondTrainingCredits';
    case 'compute':
      return 'craftTrainingCredits';
  }
}

/** On-chain score field of a stat. */
export function scoreFieldOf(
  stat: StatType,
): keyof Pick<CitizenStateOnChain, 'intelligence' | 'alignment' | 'compute'> {
  return stat;
}

/** A citizen's credits for one stat. */
export function creditsOf(citizen: CitizenStateOnChain, stat: StatType): number {
  return citizen[creditFieldOf(stat)];
}

/**
 * Whether a citizen can pay for one upgrade of `stat` without buying anything.
 *
 * Both conditions are required and neither is sufficient alone: the score must
 * have room left, and the matching credit pool must hold at least one credit.
 */
export function canUpgradeWithCredit(citizen: CitizenStateOnChain, stat: StatType): boolean {
  return canUpgrade(citizen[scoreFieldOf(stat)]) && creditsOf(citizen, stat) >= 1;
}
