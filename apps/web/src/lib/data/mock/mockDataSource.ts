import type { CitizenRecord, StatKey } from '@bas/content';
import { MAX_STAT_SCORE } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { MISSION_POINTS, startBlocker } from '../missions';
import type { DistrictActionResult, DistrictDataSource, DistrictSnapshot, HistoryEntry, SeasonSnapshot } from '../types';
import { createMockSnapshot } from './mockSnapshot';

export interface MockDataSourceOptions {
  roster: readonly CitizenRecord[];
  /** `baseTrainingCostAtoms` from the cluster manifest. */
  baseTrainingCostAtoms: string;
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** Adds season points to every leaderboard row of a citizen and keeps the rows ranked. */
function withPoints(season: SeasonSnapshot, citizenId: number, points: number): SeasonSnapshot {
  const leaderboards = Object.fromEntries(
    Object.entries(season.leaderboards).map(([bracket, rows]) => [
      bracket,
      (rows ?? [])
        .map((row) => (row.citizenId === citizenId ? { ...row, points: row.points + points } : row))
        .sort((a, b) => b.points - a.points),
    ]),
  );
  return { ...season, leaderboards };
}

/**
 * Runs the district program's checks on local state. Nothing is signed or
 * sent; the order of the checks matches `upgrade_score` and
 * `claim_training_credit` so the screens meet the same refusals later.
 */
export function createMockDataSource(options: MockDataSourceOptions): DistrictDataSource {
  let state: DistrictSnapshot = createMockSnapshot(options.roster, options.baseTrainingCostAtoms);
  const today = () => state.season.day;

  const fail = (error: Extract<DistrictActionResult, { ok: false }>['error']): DistrictActionResult => ({
    ok: false,
    error,
  });
  const commit = (next: DistrictSnapshot): DistrictActionResult => {
    state = next;
    return { ok: true, snapshot: state };
  };
  const pushHistory = (citizenId: number, entry: HistoryEntry) => ({
    ...state.history,
    [citizenId]: [entry, ...(state.history[citizenId] ?? [])],
  });

  return {
    mode: 'mock',

    snapshot: () => state,

    async upgradeScore(citizenId: number, stat: StatKey) {
      const citizen = state.citizens.find((item) => item.id === citizenId);
      if (!citizen || !state.owned.includes(citizenId)) return fail('not-owner');
      const score = citizen[stat];
      if (score >= MAX_STAT_SCORE) return fail('stat-at-max');
      const credits = state.credits[citizenId];
      if (!credits || credits[stat] < 1) return fail('no-credit');
      const cost = trainingCostAtoms(options.baseTrainingCostAtoms, score);
      if (state.wallet.tokenAtoms < cost) return fail('insufficient-balance');

      return commit({
        ...state,
        wallet: { ...state.wallet, tokenAtoms: state.wallet.tokenAtoms - cost },
        citizens: state.citizens.map((item) => (item.id === citizenId ? { ...item, [stat]: score + 1 } : item)),
        credits: { ...state.credits, [citizenId]: { ...credits, [stat]: credits[stat] - 1 } },
        history: pushHistory(citizenId, { day: today(), kind: 'train', stat, from: score, burnedAtoms: cost }),
      });
    },

    async startMission(citizenId: number, missionId: string, stat: StatKey) {
      const citizen = state.citizens.find((item) => item.id === citizenId);
      const mission = state.missions.find((item) => item.id === missionId);
      if (!citizen) return fail('not-owner');
      if (!mission) return fail('mission-closed');
      const blocker = startBlocker(state, citizen, mission);
      if (blocker) return fail(blocker);
      if (!mission.rewards.includes(stat)) return fail('invalid-stat');
      return commit({
        ...state,
        missionProgress: { ...state.missionProgress, [missionId]: { citizenId, done: 0, stat } },
      });
    },

    async advanceMission(citizenId: number, missionId: string) {
      const mission = state.missions.find((item) => item.id === missionId);
      const progress = state.missionProgress[missionId];
      if (!state.owned.includes(citizenId)) return fail('not-owner');
      if (!mission || !progress) return fail('mission-closed');
      if (progress.citizenId !== citizenId) return fail('mission-busy');

      const done = progress.done + 1;
      if (done < mission.steps.length) {
        return commit({ ...state, missionProgress: { ...state.missionProgress, [missionId]: { ...progress, done } } });
      }

      const { stat } = progress;
      const credits = state.credits[citizenId] ?? { intelligence: 0, alignment: 0, compute: 0 };
      return commit({
        ...state,
        missionProgress: without(state.missionProgress, missionId),
        credits: { ...state.credits, [citizenId]: { ...credits, [stat]: credits[stat] + 1 } },
        history: pushHistory(citizenId, { day: today(), kind: 'mission', missionId, stat }),
        season: withPoints(state.season, citizenId, MISSION_POINTS),
      });
    },

    async abandonMission(missionId: string) {
      return commit({ ...state, missionProgress: without(state.missionProgress, missionId) });
    },

    async nextDay() {
      const { season } = state;
      if (season.day >= season.length) return fail('mission-closed');
      return commit({ ...state, season: { ...season, day: season.day + 1 } });
    },
  };
}
