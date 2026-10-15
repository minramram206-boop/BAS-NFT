import type { CitizenRecord } from '@bas/content';
import { isDistrictOpen } from './districts';
import type {
  DistrictActionError,
  DistrictSnapshot,
  HistoryEntry,
  MissionDefinition,
  MissionProgress,
  MissionStep,
} from './types';

/** The parts of the district the mission limits read. */
type LimitView = Pick<DistrictSnapshot, 'history' | 'season'>;

/** Mission limits and season points (D-0025). */
export const DAILY_MISSION_CREDITS = 3;
export const MISSION_POINTS = 100;
export const EVENT_TASK_POINTS = 150;

/** Season points a finished mission pays. */
export function missionPoints(mission: Pick<MissionDefinition, 'event'>): number {
  return mission.event ? EVENT_TASK_POINTS : MISSION_POINTS;
}

function missionsOn(history: readonly HistoryEntry[] | undefined, day: number) {
  return (history ?? []).filter(
    (entry): entry is Extract<HistoryEntry, { kind: 'mission' }> => entry.kind === 'mission' && entry.day === day,
  );
}

/** Credits a citizen earned from missions today. */
export function missionsToday(snapshot: LimitView, citizenId: number): number {
  return missionsOn(snapshot.history[citizenId], snapshot.season.day).length;
}

export function doneToday(snapshot: LimitView, citizenId: number, missionId: string): boolean {
  return missionsOn(snapshot.history[citizenId], snapshot.season.day).some((entry) => entry.missionId === missionId);
}

/** The mission a citizen is on, if any. */
export function activeMissionOf(snapshot: Pick<DistrictSnapshot, 'missionProgress'>, citizenId: number): string | undefined {
  return Object.entries(snapshot.missionProgress).find(([, progress]) => progress.citizenId === citizenId)?.[0];
}

/**
 * Why `citizen` cannot start `mission` right now, or `null` when it can.
 * The order matches what the mission server checks before it co-signs.
 */
export function startBlocker(
  snapshot: LimitView & Pick<DistrictSnapshot, 'owned' | 'missionProgress'>,
  citizen: CitizenRecord,
  mission: MissionDefinition,
): DistrictActionError | null {
  if (!snapshot.owned.includes(citizen.id)) return 'not-owner';
  if (mission.opensInHours !== undefined) return 'mission-closed';
  if (!isDistrictOpen(citizen, mission.district)) return 'district-locked';
  if (snapshot.missionProgress[mission.id]) return 'mission-busy';
  if (activeMissionOf(snapshot, citizen.id)) return 'citizen-busy';
  if (doneToday(snapshot, citizen.id, mission.id)) return 'mission-cooldown';
  if (missionsToday(snapshot, citizen.id) >= DAILY_MISSION_CREDITS) return 'daily-limit';
  return null;
}

export interface CurrentStep {
  readonly mission: MissionDefinition;
  readonly progress: MissionProgress;
  readonly step: MissionStep;
  /** Zero-based index of the step being played. */
  readonly index: number;
}

/** The step a citizen is playing right now, if it is on a mission. */
export function currentStepOf(
  snapshot: Pick<DistrictSnapshot, 'missionProgress' | 'missions'>,
  citizenId: number,
): CurrentStep | undefined {
  const missionId = activeMissionOf(snapshot, citizenId);
  const mission = snapshot.missions.find((item) => item.id === missionId);
  const progress = missionId ? snapshot.missionProgress[missionId] : undefined;
  const step = mission && progress ? mission.steps[progress.done] : undefined;
  if (!mission || !progress || !step) return undefined;
  return { mission, progress, step, index: progress.done };
}
