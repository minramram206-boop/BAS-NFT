'use client';

import type { CitizenRecord, StatKey } from '@bas/content';
import { STAT_KEYS } from '@bas/content';
import { useBasStoreSlice, type BasStore, type PreviewTrainingCredits } from './basStore';
import { useBasStoreApi } from './BasStoreProvider';

/**
 * Derived read access to the store.
 * Each hook selects exactly one value, so components only re-render on the
 * state they actually use.
 */

const EMPTY_PREVIEW_CREDITS: PreviewTrainingCredits = Object.freeze({
  intelligence: 0,
  alignment: 0,
  compute: 0,
});

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

/** The citizen shown on the plaza, the profile card, and the training stage. */
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

export function usePreviewCostAtoms(): bigint {
  return useSlice((state) => state.previewCostAtoms);
}

export function useTrainingConfig() {
  return useSlice((state) => state.trainingConfig);
}

export function usePreviewTrainingCredits(citizenId: number): PreviewTrainingCredits {
  return useSlice((state) => state.previewTrainingCredits[citizenId] ?? EMPTY_PREVIEW_CREDITS);
}

export function useSfxEnabled(): boolean {
  return useSlice((state) => state.sfxEnabled);
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

export function useShowWalletConnectorUnavailable() {
  return useSlice((state) => state.showWalletConnectorUnavailable);
}

export function useToggleSfx() {
  return useSlice((state) => state.toggleSfx);
}

export function useCloseModal() {
  return useSlice((state) => state.closeModal);
}

/** Total score of one citizen across the three trainable stats. */
export function totalScore(citizen: CitizenRecord): number {
  return STAT_KEYS.reduce((sum, key: StatKey) => sum + citizen[key], 0);
}
