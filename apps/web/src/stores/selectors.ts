'use client';

import type { CitizenRecord } from '@bas/content';
import type { HistoryEntry, StatCredits } from '@/lib/data/types';
import { useBasStoreSlice, type BasStore } from './basStore';
import { useBasStoreApi } from './BasStoreProvider';

/**
 * Read access to the store. Each hook selects one stored value, never a new
 * object, so components re-render only when that value changes.
 */

const NO_CREDITS: StatCredits = Object.freeze({ intelligence: 0, alignment: 0, compute: 0 });
const NO_HISTORY: readonly HistoryEntry[] = Object.freeze([]);

function useSlice<T>(selector: (state: BasStore) => T): T {
  const api = useBasStoreApi();
  return useBasStoreSlice(api, selector);
}

export const useCitizens = () => useSlice((state) => state.citizens);
export const useSelectedCitizenId = () => useSlice((state) => state.selectedCitizenId);
export const useOwnedIds = () => useSlice((state) => state.owned);
export const useFoundingIds = () => useSlice((state) => state.founding);
export const useWallet = () => useSlice((state) => state.wallet);
export const useHistoryMap = () => useSlice((state) => state.history);
export const useMissions = () => useSlice((state) => state.missions);
export const useMissionProgress = () => useSlice((state) => state.missionProgress);
export const useSeason = () => useSlice((state) => state.season);
export const useTrainingConfig = () => useSlice((state) => state.trainingConfig);
export const useBusy = () => useSlice((state) => state.busy);
export const useDataMode = () => useSlice((state) => state.source.mode);

export function useCitizen(id: number): CitizenRecord | undefined {
  return useSlice((state) => state.citizens.find((citizen) => citizen.id === id));
}

/** The citizen the city, the profile and training act on. */
export function useSelectedCitizen(): CitizenRecord | undefined {
  return useSlice(
    (state) => state.citizens.find((citizen) => citizen.id === state.selectedCitizenId) ?? state.citizens[0],
  );
}

export function useIsOwned(id: number): boolean {
  return useSlice((state) => state.owned.includes(id));
}

export function useCredits(id: number): StatCredits {
  return useSlice((state) => state.credits[id] ?? NO_CREDITS);
}

export function useHistory(id: number): readonly HistoryEntry[] {
  return useSlice((state) => state.history[id] ?? NO_HISTORY);
}

export const useCityMode = () => useSlice((state) => state.cityMode);
export const useZoomRequest = () => useSlice((state) => state.zoomRequest);
export const useFocusRequest = () => useSlice((state) => state.focusRequest);

export const useSfxEnabled = () => useSlice((state) => state.sfxEnabled);
export const useModalState = () => useSlice((state) => state.modal);

/** Actions are stable references, safe to select individually. */
export const useSelectCitizen = () => useSlice((state) => state.selectCitizen);
export const useTrainStat = () => useSlice((state) => state.trainStat);
export const useStartMission = () => useSlice((state) => state.startMission);
export const useAdvanceMission = () => useSlice((state) => state.advanceMission);
export const useNextDay = () => useSlice((state) => state.nextDay);
export const useAbandonMission = () => useSlice((state) => state.abandonMission);
export const useSetCityMode = () => useSlice((state) => state.setCityMode);
export const useRequestZoom = () => useSlice((state) => state.requestZoom);
export const useRequestFocus = () => useSlice((state) => state.requestFocus);
export const useShowWalletConnectorUnavailable = () => useSlice((state) => state.showWalletConnectorUnavailable);
export const useToggleSfx = () => useSlice((state) => state.toggleSfx);
export const useCloseModal = () => useSlice((state) => state.closeModal);
