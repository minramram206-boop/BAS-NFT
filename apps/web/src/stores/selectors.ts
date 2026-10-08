'use client';

import type { CitizenRecord, StatKey } from '@bas/content';
import { useBasStoreSlice, type BasStore } from './basStore';
import { useBasStoreApi } from './BasStoreProvider';

/**
 * Derived read access to the store.
 * Each hook selects exactly one value, so components only re-render on the
 * state they actually use.
 */

function useSlice<T>(selector: (state: BasStore) => T): T {
  const api = useBasStoreApi();
  return useBasStoreSlice(api, selector);
}

export function useCitizens(): CitizenRecord[] {
  return useSlice((state) => state.citizens);
}

export function useSelectedCitizenId(): number {
  return useSlice((state) => state.selectedCitizenId);
}

/** The citizen shown on the plaza, the agent card, and the dojo stage. */
export function useSelectedCitizen(): CitizenRecord | undefined {
  return useSlice((state) => {
    const { citizens, selectedCitizenId } = state;
    return citizens.find((citizen) => citizen.id === selectedCitizenId) ?? citizens[0];
  });
}

export function useTrainingLog(): string {
  return useSlice((state) => state.trainingLog);
}

export function useSupplyCount(): number {
  return useSlice((state) => state.supplyCount);
}

export function useTokensBurned(): number {
  return useSlice((state) => state.tokensBurned);
}

export function useSfxEnabled(): boolean {
  return useSlice((state) => state.sfxEnabled);
}

export function useIsLoggedIn(): boolean {
  return useSlice((state) => state.isLoggedIn);
}

export function useWalletAddress(): string {
  return useSlice((state) => state.walletAddress);
}

export function useModalState() {
  return useSlice((state) => state.modal);
}

/** Actions are stable references, safe to select individually. */
export function useSelectCitizen() {
  return useSlice((state) => state.selectCitizen);
}

export function useTrainStat() {
  return useSlice((state) => state.trainStat);
}

export function useMintCitizen() {
  return useSlice((state) => state.mintCitizen);
}

export function useToggleLogin() {
  return useSlice((state) => state.toggleLogin);
}

export function useToggleSfx() {
  return useSlice((state) => state.toggleSfx);
}

export function useCloseModal() {
  return useSlice((state) => state.closeModal);
}

const STAT_SUM_KEYS: readonly StatKey[] = ['intelligence', 'alignment', 'composure'];

/** Total score of one citizen across the three trainable stats. */
export function totalScore(citizen: CitizenRecord): number {
  return STAT_SUM_KEYS.reduce((sum, key) => sum + citizen[key], 0);
}
