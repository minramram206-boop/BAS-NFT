import { createStore, useStore, type StoreApi } from 'zustand';
import { MAX_STAT_SCORE } from '@bas/content';
import type { CitizenRecord, StatKey } from '@bas/content';
import { INITIAL_SUPPLY_COUNT } from '@/config/constants';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';

/**
 * Presentation store for District 01.
 *
 * The roster is loaded on the server by `@bas/content/server` and passed to
 * `createBasStore`, so the pre-rendered HTML and the hydrated client markup
 * start from exactly the same state. One store instance is created per
 * request/page load; see `CitizenRosterProvider`.
 *
 * Nothing stored here is canonical: ownership, progression, burns and credits
 * must be verified by the District program and trusted server logic.
 */

export type RegistryFilter = 'all' | 'registered' | 'unregistered';

export interface ModalState {
  isOpen: boolean;
  title: string;
  message: string;
}

export interface BasStore {
  citizens: CitizenRecord[];
  selectedCitizenId: number;
  /** Remaining mintable citizen slots. */
  supplyCount: number;
  /** Utility tokens burned in the current session. */
  tokensBurned: number;
  sfxEnabled: boolean;
  isLoggedIn: boolean;
  /** Placeholder address until the Wallet Standard adapter is integrated. */
  walletAddress: string;
  trainingLog: string;
  modal: ModalState;

  selectCitizen: (id: number) => void;
  trainStat: (stat: StatKey, targetElement?: HTMLElement | null) => void;
  mintCitizen: () => void;
  toggleLogin: () => void;
  toggleSfx: () => void;
  openModal: (title: string, message: string) => void;
  closeModal: () => void;
}

export interface CreateBasStoreOptions {
  /** Validated roster produced by `@bas/content/server`. */
  citizens?: readonly CitizenRecord[] | undefined;
  supplyCount?: number | undefined;
}

const CLOSED_MODAL: ModalState = { isOpen: false, title: '', message: '' };
const DEFAULT_TRAINING_LOG = 'pelatihan selesai.<br>satu skor bertambah.';
const DEFAULT_WALLET_LABEL = '7xKX...4C1d';

export type BasStoreApi = StoreApi<BasStore>;

export function createBasStore(options: CreateBasStoreOptions = {}): BasStoreApi {
  const citizens = (options.citizens ?? []).map((citizen) => ({ ...citizen }));

  return createStore<BasStore>()((set, get) => ({
    citizens,
    selectedCitizenId: citizens[0]?.id ?? 0,
    supplyCount: options.supplyCount ?? INITIAL_SUPPLY_COUNT,
    tokensBurned: 0,
    sfxEnabled: true,
    isLoggedIn: false,
    walletAddress: DEFAULT_WALLET_LABEL,
    trainingLog: DEFAULT_TRAINING_LOG,
    modal: CLOSED_MODAL,

    selectCitizen: (id) => {
      retroAudio.play('click');
      set({ selectedCitizenId: id });
    },

    trainStat: (stat, targetElement) => {
      const { citizens: roster, selectedCitizenId, tokensBurned, openModal } = get();
      const citizen = roster.find((item) => item.id === selectedCitizenId);
      if (!citizen) return;

      if (citizen[stat] >= MAX_STAT_SCORE) {
        openModal(
          'STAT MAXED',
          `${citizen.name} has already reached maximum score (${MAX_STAT_SCORE}) in ${stat}.`,
        );
        return;
      }

      retroAudio.play('train');

      set({
        citizens: roster.map((item) =>
          item.id === selectedCitizenId
            ? { ...item, [stat]: Math.min(MAX_STAT_SCORE, item[stat] + 1) }
            : item,
        ),
        tokensBurned: tokensBurned + 1,
        trainingLog: `pelatihan selesai.<br>satu skor ${stat} bertambah.`,
      });

      if (targetElement && typeof document !== 'undefined') {
        spawnFloatingStatEffect(targetElement, stat);
      }
    },

    mintCitizen: () => {
      retroAudio.play('click');
      const { supplyCount, citizens: roster, openModal } = get();

      if (supplyCount <= 0) {
        openModal('SUPPLY EXHAUSTED', `All ${INITIAL_SUPPLY_COUNT} citizen slots have been minted!`);
        return;
      }

      const candidate = roster.find((item) => !item.registered);
      if (!candidate) {
        openModal(
          'ALL REGISTERED',
          `All ${roster.length} citizens currently in the registry directory are already registered!`,
        );
        return;
      }

      retroAudio.play('mint');
      set({
        citizens: roster.map((item) =>
          item.id === candidate.id ? { ...item, registered: true } : item,
        ),
        supplyCount: supplyCount - 1,
        selectedCitizenId: candidate.id,
      });

      openModal(
        'MINT SUCCESSFUL! 🥚✨',
        `<strong>${candidate.name} (${candidate.code})</strong> has officially registered into District 01!` +
          `<br><br>Role: <em>${candidate.role}</em>` +
          `<br>Remaining Supply: <strong>${supplyCount - 1} / ${INITIAL_SUPPLY_COUNT}</strong>`,
      );
    },

    toggleLogin: () => {
      retroAudio.play('click');
      const { isLoggedIn, walletAddress, openModal } = get();

      if (isLoggedIn) {
        set({ isLoggedIn: false });
        openModal('WALLET DISCONNECTED', 'Wallet connection terminated.');
        return;
      }

      set({ isLoggedIn: true });
      openModal(
        'WALLET CONNECTED',
        `Connected with address:<br><strong>${walletAddress}</strong><br>District L2 Online.`,
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

/** Transient "+1 XXX" effect rendered outside the React tree for the arcade feel. */
function spawnFloatingStatEffect(targetElement: HTMLElement, stat: StatKey): void {
  const rect = targetElement.getBoundingClientRect();
  const effect = document.createElement('div');

  effect.className = 'floating-stat-fx';
  effect.textContent = `+1 ${stat.toUpperCase().slice(0, 3)}`;
  effect.style.left = `${rect.left + rect.width / 2 - 20}px`;
  effect.style.top = `${rect.top - 10}px`;

  document.body.append(effect);
  setTimeout(() => effect.remove(), 800);
}
