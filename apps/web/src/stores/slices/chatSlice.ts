import type { ChatSlice, GetState, SetState } from '../types';

/** Lines kept per citizen; the server keeps its own, shorter, conversation. */
const MAX_LINES = 80;

let nextLineId = 1;
let nextReaction = 0;

/** What was said on screen, per citizen, so leaving the profile and coming back does not empty it. */
export function createChatSlice(set: SetState, get: GetState): ChatSlice {
  return {
    chatLogs: {},
    reactions: {},

    react: (citizenId, animation, emotion) => {
      nextReaction += 1;
      set({ reactions: { ...get().reactions, [citizenId]: { animation, emotion, nonce: nextReaction } } });
    },

    addChatLine: (citizenId, line) => {
      const id = nextLineId++;
      const current = get().chatLogs[citizenId] ?? [];
      set({ chatLogs: { ...get().chatLogs, [citizenId]: [...current, { ...line, id }].slice(-MAX_LINES) } });
      return id;
    },

    removeChatLine: (citizenId, id) => {
      const current = get().chatLogs[citizenId];
      if (!current) return;
      set({ chatLogs: { ...get().chatLogs, [citizenId]: current.filter((line) => line.id !== id) } });
    },

    resetChat: () => set({ chatLogs: {}, reactions: {} }),

    clearChatLog: (citizenId) => {
      const { [citizenId]: _removed, ...rest } = get().chatLogs;
      set({ chatLogs: rest });
    },
  };
}
