import { MESSAGES } from '@/messages';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';
import type { GetState, ModalState, SetState, UiSlice } from '../types';

const CLOSED_MODAL: ModalState = { isOpen: false, title: '', message: '' };

/** Modal, sound toggle and the wallet placeholder. */
export function createUiSlice(set: SetState, get: GetState): UiSlice {
  return {
    focus: { training: null, mission: null },
    missionPrompt: { dismissed: null, arrived: null },
    reward: null,
    sfxEnabled: true,
    modal: CLOSED_MODAL,
    walletDialog: false,

    dismissMissionPrompt: (stepKey) => set({ missionPrompt: { ...get().missionPrompt, dismissed: stepKey } }),
    reopenMissionPrompt: () => set({ missionPrompt: { ...get().missionPrompt, dismissed: null } }),
    markMissionArrival: (stepKey) => set({ missionPrompt: { dismissed: null, arrived: stepKey } }),

    setFocus: (focus) => set({ focus: { ...get().focus, ...focus } }),

    openWallet: () => {
      retroAudio.play('click');
      if (get().source.mode === 'chain') set({ walletDialog: true });
      else get().openModal(MESSAGES.actions.walletTitle, MESSAGES.actions.walletMessage);
    },

    closeWalletDialog: () => set({ walletDialog: false }),

    closeReward: () => {
      retroAudio.play('click');
      set({ reward: null });
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
  };
}
