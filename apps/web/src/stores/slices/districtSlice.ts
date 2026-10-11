import type { StatKey } from '@bas/content';
import { MISSION_POINTS } from '@/lib/data/missions';
import { createMockDataSource } from '@/lib/data/mock/mockDataSource';
import type { DistrictActionResult, DistrictSnapshot, MissionDefinition } from '@/lib/data/types';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';
import { spawnFloatingStatEffect } from '@/lib/effects/floatingStatEffect';
import { MESSAGES, formatMessage } from '@/messages';
import type { CreateBasStoreOptions, DistrictSlice, GetState, SetState } from '../types';

function fromSnapshot(snapshot: DistrictSnapshot) {
  return { ...snapshot, citizens: [...snapshot.citizens] };
}

/** Citizens, progress, missions and season, all read and changed through the data source. */
export function createDistrictSlice(options: CreateBasStoreOptions, set: SetState, get: GetState): DistrictSlice {
  const source = createMockDataSource({
    roster: options.citizens,
    baseTrainingCostAtoms: options.trainingConfig.baseTrainingCostAtoms,
  });
  const initial = source.snapshot();

  const run = async (action: () => Promise<DistrictActionResult>): Promise<DistrictSnapshot | null> => {
    if (get().busy) return null;
    set({ busy: true, lastError: null });
    const result = await action();
    if (!result.ok) {
      const copy = MESSAGES.errors[result.error];
      set({ busy: false, lastError: result.error });
      get().openModal(copy.title, copy.message);
      return null;
    }
    set({ ...fromSnapshot(result.snapshot), busy: false });
    return result.snapshot;
  };

  return {
    ...fromSnapshot(initial),
    source,
    trainingConfig: { ...options.trainingConfig },
    selectedCitizenId: initial.owned[0] ?? initial.citizens[0]?.id ?? 0,
    busy: false,
    lastError: null,

    selectCitizen: (id) => {
      if (id === get().selectedCitizenId) return;
      retroAudio.play('click');
      set({ selectedCitizenId: id });
    },

    trainStat: async (stat: StatKey, targetElement) => {
      const citizenId = get().selectedCitizenId;
      const next = await run(() => source.upgradeScore(citizenId, stat));
      if (!next) return false;
      retroAudio.play('train');
      if (targetElement) spawnFloatingStatEffect(targetElement, MESSAGES.stats[stat].label);
      return true;
    },

    startMission: async (mission: MissionDefinition, stat: StatKey) => {
      const citizenId = get().selectedCitizenId;
      const next = await run(() => source.startMission(citizenId, mission.id, stat));
      if (!next) return false;
      retroAudio.play('click');
      // Walking steps are played on the map, so the citizen follows taps from here on.
      set({ cityMode: 'control' });
      return true;
    },

    advanceMission: async (mission: MissionDefinition) => {
      const citizenId = get().selectedCitizenId;
      const before = get().missionProgress[mission.id];
      const next = await run(() => source.advanceMission(citizenId, mission.id));
      if (!next) return false;
      const finished = before !== undefined && next.missionProgress[mission.id] === undefined;
      retroAudio.play(finished ? 'mint' : 'click');
      if (finished) {
        const stat = before.stat;
        const citizen = next.citizens.find((item) => item.id === citizenId);
        get().openModal(
          MESSAGES.missions.completeTitle,
          formatMessage(MESSAGES.missions.completeMessage, {
            name: citizen?.name ?? '',
            stat: MESSAGES.stats[stat].label,
            points: MISSION_POINTS,
          }),
        );
      }
      return true;
    },

    abandonMission: async (missionId: string) => {
      await run(() => source.abandonMission(missionId));
    },

    nextDay: async () => {
      const { nextDay } = source;
      if (!nextDay) return;
      await run(() => nextDay());
    },

    clearError: () => set({ lastError: null }),
  };
}
