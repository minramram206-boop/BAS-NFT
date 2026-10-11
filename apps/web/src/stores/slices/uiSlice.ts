import { MESSAGES } from '@/messages';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';
import type { GetState, ModalState, SetState, UiSlice } from '../types';

const CLOSED_MODAL: ModalState = { isOpen: false, title: '', message: '' };

/** Modal, sound toggle and the wallet placeholder. */
export function createUiSlice(set: SetState, get: GetState): UiSlice {
  return {
    sfxEnabled: true,
    modal: CLOSED_MODAL,

    showWalletConnectorUnavailable: () => {
      retroAudio.play('click');
      get().openModal(MESSAGES.actions.walletTitle, MESSAGES.actions.walletMessage);
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
