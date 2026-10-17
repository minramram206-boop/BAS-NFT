import type { CitizenRecord, StatKey } from '@bas/content';
import { MAX_STAT_SCORE, STAT_KEYS } from '@bas/content';
import { tierOf, trainingCostAtoms } from '@bas/chain-client/stats';
import { TIER_SCORES } from '../../config/constants';
import { DISTRICT_ORDER, DISTRICT_RULES, isDistrictOpen } from './districts';
import { DAILY_MISSION_CREDITS, activeMissionOf, startBlocker } from './missions';
import type { DistrictActionError, DistrictId, DistrictSnapshot, MissionDefinition, StatCredits } from './types';

/**
 * The route from Tier 0 to Tier 3 for one citizen (SPEC §5.3, §7, D-0043).
 *
 * Everything here is derived from the same snapshot the screens already read,
 * so it follows the program rules: a mission gives a credit, a credit plus a
 * token burn raises one stat by one, and a stat reaching 3, 6 or 10 opens the
 * districts and brackets tied to that tier. No copy lives in this file.
 */

export type Tier = 0 | 1 | 2 | 3;

const NO_CREDITS: StatCredits = { intelligence: 0, alignment: 0, compute: 0 };

/** The parts of the snapshot the plan reads. */
export type JourneyInput = Pick<
  DistrictSnapshot,
  'owned' | 'credits' | 'wallet' | 'missions' | 'missionProgress' | 'history' | 'season'
> & { readonly baseTrainingCostAtoms: string };

/** A mission that gives a credit for a stat, and what stops the citizen from starting it. */
export interface MissionOption {
  readonly mission: MissionDefinition;
  /** `null` when the citizen can start it right now. */
  readonly blocker: DistrictActionError | null;
}

/** Where one stat stands on its way to the next tier. */
export interface StatPath {
  readonly stat: StatKey;
  readonly score: number;
  readonly tier: Tier;
  /** `null` once the stat is at the maximum. */
  readonly nextTier: 1 | 2 | 3 | null;
  readonly nextScore: number | null;
  /** Upgrades left to the next tier; `0` at the maximum. */
  readonly upgradesLeft: number;
  readonly credits: number;
  /** Credits still to earn from missions before the next tier is reachable. */
  readonly creditsMissing: number;
  /** Token atoms to burn for the next upgrade, `null` at the maximum. */
  readonly nextUpgradeCost: bigint | null;
  /** Token atoms for every upgrade up to the next tier. */
  readonly tierCost: bigint;
  /** Districts that this stat opens at the next tier and are still closed to the citizen. */
  readonly opens: readonly DistrictId[];
  /** Missions that give a credit for this stat, in the order they are defined. */
  readonly missions: readonly MissionOption[];
}

/** One rung of the tier ladder. */
export interface TierRung {
  readonly tier: 1 | 2 | 3;
  readonly score: number;
  /** A stat of the citizen is at or past this score. */
  readonly reached: boolean;
  /** Districts that open at this tier. */
  readonly districts: readonly DistrictId[];
}

export type NextStep =
  | { readonly kind: 'not-owner' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'continue-mission'; readonly missionId: string; readonly step: number; readonly steps: number }
  | {
      readonly kind: 'train';
      readonly stat: StatKey;
      readonly from: number;
      readonly cost: bigint;
      /** The tier this upgrade reaches, or `null` when it stays in the same tier. */
      readonly reachesTier: 1 | 2 | 3 | null;
    }
  | { readonly kind: 'earn-tokens'; readonly stat: StatKey; readonly missing: bigint }
  | { readonly kind: 'start-mission'; readonly missionId: string; readonly stat: StatKey }
  /** Every mission that could help is done for today, or the daily limit is reached. */
  | { readonly kind: 'wait'; readonly reason: 'daily-limit' | 'cooldown' }
  /** Nothing is open right now, for example only a district event that has not started. */
  | { readonly kind: 'idle' };

/** How long the closest tier takes if the citizen takes every mission that helps, once a day. */
export interface Pace {
  readonly stat: StatKey;
  readonly tier: 1 | 2 | 3;
  readonly days: number;
}

export interface Journey {
  readonly owned: boolean;
  /** The highest tier across the three stats. */
  readonly tier: Tier;
  /** `null` when a tier can be reached today, no mission helps, or every stat is at the maximum. */
  readonly pace: Pace | null;
  readonly paths: readonly StatPath[];
  readonly rungs: readonly TierRung[];
  readonly next: NextStep;
}

function districtsAt(score: number): DistrictId[] {
  return DISTRICT_ORDER.filter((id) => DISTRICT_RULES[id].unlockScore === score);
}

function pathOf(citizen: CitizenRecord, stat: StatKey, credits: StatCredits, input: JourneyInput): StatPath {
  const score = citizen[stat];
  const nextScore = TIER_SCORES.find((threshold) => threshold > score) ?? null;
  const nextTier = nextScore === null ? null : ((TIER_SCORES.indexOf(nextScore as (typeof TIER_SCORES)[number]) + 1) as 1 | 2 | 3);
  const upgradesLeft = nextScore === null ? 0 : nextScore - score;
  const held = credits[stat];

  let tierCost = 0n;
  for (let at = score; nextScore !== null && at < nextScore; at += 1) {
    tierCost += trainingCostAtoms(input.baseTrainingCostAtoms, at);
  }

  const opens =
    nextScore === null
      ? []
      : DISTRICT_ORDER.filter((id) => {
          const rule = DISTRICT_RULES[id];
          return rule.unlockScore === nextScore && rule.stats.includes(stat) && !isDistrictOpen(citizen, id);
        });

  return {
    stat,
    score,
    tier: tierOf(score),
    nextTier,
    nextScore,
    upgradesLeft,
    credits: held,
    creditsMissing: Math.max(upgradesLeft - held, 0),
    nextUpgradeCost: score >= MAX_STAT_SCORE ? null : trainingCostAtoms(input.baseTrainingCostAtoms, score),
    tierCost,
    opens,
    missions: input.missions
      .filter((mission) => mission.rewards.includes(stat))
      .map((mission) => ({ mission, blocker: startBlocker(input, citizen, mission) })),
  };
}

/** Closest to the next tier first; ties keep the order Insight, Bond, Craft. */
function byProgress(a: StatPath, b: StatPath): number {
  return a.upgradesLeft - b.upgradesLeft;
}

const reachesTier = (path: StatPath) => (TIER_SCORES as readonly number[]).includes(path.score + 1);

function trainStep(path: StatPath): NextStep {
  return {
    kind: 'train',
    stat: path.stat,
    from: path.score,
    cost: path.nextUpgradeCost as bigint,
    reachesTier: reachesTier(path) ? (tierOf(path.score + 1) as 1 | 2 | 3) : null,
  };
}

/**
 * What to do next. A paid-for upgrade that reaches a new tier comes first, since
 * it is instant and the milestone the route leads to; then the mission in
 * progress; then any other upgrade; then the mission that moves the closest stat.
 */
function nextStepFor(citizen: CitizenRecord, paths: readonly StatPath[], input: JourneyInput): NextStep {
  const open = paths.filter((path) => path.nextUpgradeCost !== null);
  const trainable = open.filter((path) => path.credits >= 1);
  const affordable = trainable.filter((path) => (path.nextUpgradeCost as bigint) <= input.wallet.tokenAtoms);

  const tierUp = affordable.filter(reachesTier).sort(byProgress)[0];
  if (tierUp) return trainStep(tierUp);

  const activeId = activeMissionOf(input, citizen.id);
  const active = input.missions.find((mission) => mission.id === activeId);
  const progress = activeId ? input.missionProgress[activeId] : undefined;
  if (active && progress) {
    return { kind: 'continue-mission', missionId: active.id, step: Math.min(progress.done + 1, active.steps.length), steps: active.steps.length };
  }

  if (open.length === 0) return { kind: 'complete' };

  const upgrade = [...affordable].sort(byProgress)[0];
  if (upgrade) return trainStep(upgrade);
  if (trainable.length > 0) {
    const cheapest = [...trainable].sort((a, b) => Number((a.nextUpgradeCost as bigint) - (b.nextUpgradeCost as bigint)))[0] as StatPath;
    return { kind: 'earn-tokens', stat: cheapest.stat, missing: (cheapest.nextUpgradeCost as bigint) - input.wallet.tokenAtoms };
  }

  for (const path of [...open].sort(byProgress)) {
    const ready =
      path.missions.find((option) => option.blocker === null && option.mission.rewards[0] === path.stat) ??
      path.missions.find((option) => option.blocker === null);
    if (ready) return { kind: 'start-mission', missionId: ready.mission.id, stat: path.stat };
  }

  const blockers = open.flatMap((path) => path.missions.map((option) => option.blocker));
  if (blockers.includes('daily-limit')) return { kind: 'wait', reason: 'daily-limit' };
  if (blockers.includes('mission-cooldown')) return { kind: 'wait', reason: 'cooldown' };
  return { kind: 'idle' };
}

/**
 * Days until `path` can reach its next tier. A mission gives one credit and
 * each can be done once a day (D-0043), so the credits a stat still needs are
 * earned at the pace of the open missions that give it, up to the daily limit.
 */
function daysToNextTier(citizen: CitizenRecord, path: StatPath, input: JourneyInput): number | null {
  if (path.nextTier === null) return null;
  if (path.creditsMissing === 0) return 0;
  const perDay = Math.min(
    DAILY_MISSION_CREDITS,
    input.missions.filter(
      (mission) => mission.opensInHours === undefined && mission.rewards.includes(path.stat) && isDistrictOpen(citizen, mission.district),
    ).length,
  );
  return perDay === 0 ? null : Math.ceil(path.creditsMissing / perDay);
}

function paceOf(citizen: CitizenRecord, paths: readonly StatPath[], input: JourneyInput): Pace | null {
  const options = paths.map((path) => ({ path, days: daysToNextTier(citizen, path, input) }));
  if (options.some((option) => option.days === 0)) return null;
  const closest = options
    .filter((option): option is { path: StatPath & { nextTier: 1 | 2 | 3 }; days: number } => option.days !== null)
    .sort((a, b) => a.days - b.days || a.path.upgradesLeft - b.path.upgradesLeft)[0];
  return closest ? { stat: closest.path.stat, tier: closest.path.nextTier, days: closest.days } : null;
}

/** Plans the route of one citizen from the district snapshot. */
export function planJourney(input: JourneyInput, citizen: CitizenRecord): Journey {
  const owned = input.owned.includes(citizen.id);
  const credits = input.credits[citizen.id] ?? NO_CREDITS;
  const paths = STAT_KEYS.map((stat) => pathOf(citizen, stat, credits, input));
  const best = Math.max(...STAT_KEYS.map((stat) => citizen[stat]));

  return {
    owned,
    tier: tierOf(best),
    pace: owned ? paceOf(citizen, paths, input) : null,
    paths,
    rungs: TIER_SCORES.map((score, index) => ({
      tier: (index + 1) as 1 | 2 | 3,
      score,
      reached: best >= score,
      districts: districtsAt(score),
    })),
    next: owned ? nextStepFor(citizen, paths, input) : { kind: 'not-owner' },
  };
}

/** What a training step opened, or `null` when the stat stayed in its tier. */
export interface TierUp {
  readonly stat: StatKey;
  readonly tier: 1 | 2 | 3;
  readonly opened: readonly DistrictId[];
}

export function tierUpOf(before: CitizenRecord, after: CitizenRecord, stat: StatKey): TierUp | null {
  const tier = tierOf(after[stat]);
  if (tier === 0 || tier <= tierOf(before[stat])) return null;
  return {
    stat,
    tier,
    opened: DISTRICT_ORDER.filter((id) => !isDistrictOpen(before, id) && isDistrictOpen(after, id)),
  };
}
