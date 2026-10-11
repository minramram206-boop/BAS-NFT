import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';
import type { CitySlice, GetState, SetState } from '../types';

/** Controls of the city scene; the scene reads these and reacts. */
export function createCitySlice(set: SetState, get: GetState): CitySlice {
  return {
    cityMode: 'control',
    zoomRequest: { id: 0, step: 1 },
    focusRequest: 0,

    setCityMode: (mode) => {
      if (mode === get().cityMode) return;
      retroAudio.play('switch');
      set({ cityMode: mode });
    },

    requestZoom: (step) => set({ zoomRequest: { id: get().zoomRequest.id + 1, step } }),

    requestFocus: () => set({ focusRequest: get().focusRequest + 1 }),
  };
}
