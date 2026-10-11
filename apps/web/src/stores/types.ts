import type { StoreApi } from 'zustand';
import type { CitizenRecord, StatKey } from '@bas/content';
import type {
  DistrictActionError,
  DistrictDataSource,
  DistrictSnapshot,
  MissionDefinition,
} from '@/lib/data/types';

/**
 * Shape of the BAS District presentation store.
 *
 * Every read and write goes through one `DistrictDataSource` (D-0020). In
 * mock mode nothing becomes chain state and no transaction is sent.
 */

export interface ModalState {
  isOpen: boolean;
  title: string;
  message: string;
}

/** Values read from the selected cluster manifest. */
export interface TrainingConfig {
  baseTrainingCostAtoms: string;
  tokenDecimals: number;
  tokenSymbol: string;
}

export interface DistrictSlice extends Omit<DistrictSnapshot, 'citizens'> {
  /** Kept mutable for the existing selectors; replaced whole on every change. */
  citizens: CitizenRecord[];
  source: DistrictDataSource;
  trainingConfig: TrainingConfig;
  selectedCitizenId: number;
  /** True while a data-source call is running. */
  busy: boolean;
  /** Result of the last action, shown by the screen that started it. */
  lastError: DistrictActionError | null;
  selectCitizen: (id: number) => void;
  trainStat: (stat: StatKey, targetElement?: HTMLElement | null) => Promise<boolean>;
  startMission: (mission: MissionDefinition, stat: StatKey) => Promise<boolean>;
  advanceMission: (mission: MissionDefinition) => Promise<boolean>;
  /** Mock only: one day forward, to try the daily mission limits. */
  nextDay: () => Promise<void>;
  abandonMission: (missionId: string) => Promise<void>;
  clearError: () => void;
}

export type CityMode = 'auto' | 'control';

export interface CitySlice {
  cityMode: CityMode;
  /** Bumped to ask the scene to zoom; the sign is the direction. */
  zoomRequest: { id: number; step: 1 | -1 };
  /** Bumped to ask the scene to center on the selected citizen. */
  focusRequest: number;
  setCityMode: (mode: CityMode) => void;
  requestZoom: (step: 1 | -1) => void;
  requestFocus: () => void;
}

export interface UiSlice {
  sfxEnabled: boolean;
  modal: ModalState;
  showWalletConnectorUnavailable: () => void;
  toggleSfx: () => void;
  openModal: (title: string, message: string) => void;
  closeModal: () => void;
}

export type BasStore = DistrictSlice & CitySlice & UiSlice;

export interface CreateBasStoreOptions {
  /** Validated roster produced by `@bas/content/server`. */
  citizens: readonly CitizenRecord[];
  /** Configured cost inputs. */
  trainingConfig: TrainingConfig;
}

export type SetState = StoreApi<BasStore>['setState'];
export type GetState = StoreApi<BasStore>['getState'];
