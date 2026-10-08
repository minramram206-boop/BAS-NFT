import { createStore, useStore, type StoreApi } from 'zustand';
import { MAX_STAT_SCORE } from '@bas/content';
import type { CitizenRecord, StatKey } from '@bas/content';
import { formatTokenAtoms, trainingCostAtoms } from '@bas/chain-client/stats';
import { STAT_META } from '@/config/constants';
import { MESSAGES, formatMessage } from '@/messages';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';

/**
 * Presentation store for District 01.
 *
 * This is a Phase A local preview: mock scores, preview Training Credits, and
 * estimated costs never become canonical chain state and never send a
 * transaction. The production wallet/program integration is not enabled.
 */

export type RegistryFilter = 'all' | 'registered' | 'unregistered';

export interface ModalState {
  isOpen: boolean;
  title: string;
  message: string;
}

/** Values read from the selected cluster manifest, used only for estimates. */
export interface TrainingPreviewConfig {
  baseTrainingCostAtoms: string;
  tokenDecimals: number;
  tokenSymbol: string;
}

/** One mock balance per public Training Credit type. */
export type PreviewTrainingCredits = Readonly<Record<StatKey, number>>;

export interface BasStore {
  citizens: CitizenRecord[];
  selectedCitizenId: number;
  /** Remaining sample slots in this local preview. */
  supplyCount: number;
  maxSupply: number;
  /** Estimated token atoms for preview upgrades; no tokens are transferred. */
  previewCostAtoms: bigint;
  /** One local-only balance for each stat-specific Training Credit pool. */
  previewTrainingCredits: Readonly<Record<number, PreviewTrainingCredits>>;
  trainingConfig: TrainingPreviewConfig;
  sfxEnabled: boolean;
  trainingLog: string;
  modal: ModalState;

  selectCitizen: (id: number) => void;
  trainStat: (stat: StatKey, targetElement?: HTMLElement | null) => void;
  mintCitizen: () => void;
  showWalletConnectorUnavailable: () => void;
  toggleSfx: () => void;
  openModal: (title: string, message: string) => void;
  closeModal: () => void;
}

export interface CreateBasStoreOptions {
  /** Validated roster produced by `@bas/content/server`. */
  citizens: readonly CitizenRecord[];
  /** Maximum preview supply from the selected network manifest. */
  maxSupply: number;
  /** Configured cost inputs; used for estimates only. */
  trainingConfig: TrainingPreviewConfig;
}

const CLOSED_MODAL: ModalState = { isOpen: false, title: '', message: '' };
const PREVIEW_CREDITS_PER_STAT = 1;

function createPreviewCredits(citizens: readonly CitizenRecord[]): Readonly<Record<number, PreviewTrainingCredits>> {
  return Object.freeze(Object.fromEntries(
    citizens.map((citizen) => [citizen.id, Object.freeze({
      intelligence: PREVIEW_CREDITS_PER_STAT,
      alignment: PREVIEW_CREDITS_PER_STAT,
      compute: PREVIEW_CREDITS_PER_STAT,
    })]),
  ));
}

function publicCreditLabel(stat: StatKey): string {
  return STAT_META[stat].label;
}

export type BasStoreApi = StoreApi<BasStore>;

export function createBasStore(options: CreateBasStoreOptions): BasStoreApi {
  const citizens = options.citizens.map((citizen) => ({ ...citizen }));
  const maxSupply = options.maxSupply;
  const trainingConfig = { ...options.trainingConfig };

  return createStore<BasStore>()((set, get) => ({
    citizens,
    selectedCitizenId: citizens[0]?.id ?? 0,
    supplyCount: maxSupply,
    maxSupply,
    previewCostAtoms: 0n,
    previewTrainingCredits: createPreviewCredits(citizens),
    trainingConfig,
    sfxEnabled: true,
    trainingLog: MESSAGES.training.previewReady,
    modal: CLOSED_MODAL,

    selectCitizen: (id) => {
      retroAudio.play('click');
      set({ selectedCitizenId: id });
    },

    trainStat: (stat, targetElement) => {
      const {
        citizens: roster,
        selectedCitizenId,
        previewCostAtoms,
        previewTrainingCredits,
        trainingConfig: costConfig,
        openModal,
      } = get();
      const citizen = roster.find((item) => item.id === selectedCitizenId);
      if (!citizen) return;

      const publicLabel = publicCreditLabel(stat);
      if (citizen[stat] >= MAX_STAT_SCORE) {
        openModal(
          MESSAGES.training.maxModalTitle,
          formatMessage(MESSAGES.training.maxModal, {
            citizen: citizen.name,
            max: MAX_STAT_SCORE,
            stat: publicLabel,
          }),
        );
        return;
      }

      const credits = previewTrainingCredits[citizen.id] ?? {
        intelligence: 0,
        alignment: 0,
        compute: 0,
      };
      if (credits[stat] < 1) {
        openModal(
          MESSAGES.training.creditModalTitle,
          formatMessage(MESSAGES.training.creditModal, {
            stat: publicLabel,
          }),
        );
        return;
      }

      const currentScore = citizen[stat];
      const costAtoms = trainingCostAtoms(costConfig.baseTrainingCostAtoms, currentScore);
      const cost = formatTokenAtoms(costAtoms, costConfig.tokenDecimals);
      const nextScore = currentScore + 1;
      const nextCredits = { ...credits, [stat]: credits[stat] - 1 };

      retroAudio.play('train');
      set({
        citizens: roster.map((item) =>
          item.id === selectedCitizenId ? { ...item, [stat]: nextScore } : item,
        ),
        previewCostAtoms: previewCostAtoms + costAtoms,
        previewTrainingCredits: {
          ...previewTrainingCredits,
          [citizen.id]: nextCredits,
        },
        trainingLog: formatMessage(MESSAGES.training.previewSuccess, {
          stat: publicLabel,
          value: nextScore,
          cost,
          symbol: costConfig.tokenSymbol,
        }),
      });

      if (targetElement && typeof document !== 'undefined') {
        spawnFloatingStatEffect(targetElement, stat);
      }
    },

    mintCitizen: () => {
      retroAudio.play('click');
      const { supplyCount, maxSupply: totalSupply, citizens: roster, openModal } = get();

      if (supplyCount <= 0) {
        openModal(MESSAGES.actions.noSlotsTitle, MESSAGES.actions.noSlotsMessage);
        return;
      }

      const candidate = roster.find((item) => !item.registered);
      if (!candidate) {
        openModal(
          MESSAGES.actions.allRegisteredTitle,
          formatMessage(MESSAGES.actions.allRegisteredMessage, { count: roster.length }),
        );
        return;
      }

      retroAudio.play('mint');
      const remaining = supplyCount - 1;
      set({
        citizens: roster.map((item) =>
          item.id === candidate.id ? { ...item, registered: true } : item,
        ),
        supplyCount: remaining,
        selectedCitizenId: candidate.id,
      });

      openModal(
        MESSAGES.actions.previewRegistrationTitle,
        formatMessage(MESSAGES.actions.previewRegistrationMessage, {
          name: candidate.name,
          code: candidate.code,
          role: candidate.role,
          remaining,
          total: totalSupply,
        }),
      );
    },

    showWalletConnectorUnavailable: () => {
      retroAudio.play('click');
      get().openModal(
        MESSAGES.actions.walletUnavailableTitle,
        MESSAGES.actions.walletUnavailableMessage,
      );
    },

    toggleSfx: () => {
      const next = !get().sfxEnabled;
      retroAudio.enabled = next;
      set({ sfxEnabled: next });
      if (next) retroAudio.play('click');
    },

    openModal: (title, message) => {
      set({ modal: { isOpen: true, title, message } });
    },

    closeModal: () => {
      retroAudio.play('click');
      set({ modal: CLOSED_MODAL });
    },
  }));
}

/** Read one slice of the store. Use through the hooks in `stores/selectors.ts`. */
export function useBasStoreSlice<T>(api: BasStoreApi, selector: (state: BasStore) => T): T {
  return useStore(api, selector);
}

/** Transient public-label effect rendered outside the React tree. */
function spawnFloatingStatEffect(targetElement: HTMLElement, stat: StatKey): void {
  const rect = targetElement.getBoundingClientRect();
  const effect = document.createElement('div');

  effect.className = 'floating-stat-fx';
  effect.textContent = `+1 ${STAT_META[stat].label.toUpperCase()}`;
  effect.style.left = `${rect.left + rect.width / 2 - 20}px`;
  effect.style.top = `${rect.top - 10}px`;

  document.body.append(effect);
  setTimeout(() => effect.remove(), 800);
}
