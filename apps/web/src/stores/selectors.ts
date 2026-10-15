'use client';

import type { CitizenRecord } from '@bas/content';
import type { HistoryEntry, MarketAuction, MarketListing, StatCredits } from '@/lib/data/types';
import type { ChatLine, CitizenReaction } from './types';
import { useBasStoreSlice, type BasStore } from './basStore';
import { useBasStoreApi } from './BasStoreProvider';

/**
 * Read access to the store. Each hook selects one stored value, never a new
 * object, so components re-render only when that value changes.
 */

const NO_CREDITS: StatCredits = Object.freeze({ intelligence: 0, alignment: 0, compute: 0 });
const NO_HISTORY: readonly HistoryEntry[] = Object.freeze([]);
const NO_LINES: readonly ChatLine[] = Object.freeze([]);

function useSlice<T>(selector: (state: BasStore) => T): T {
  const api = useBasStoreApi();
  return useBasStoreSlice(api, selector);
}

export const useCitizens = () => useSlice((state) => state.citizens);
export const useSelectedCitizenId = () => useSlice((state) => state.selectedCitizenId);
export const useOwnedIds = () => useSlice((state) => state.owned);
export const useFoundingIds = () => useSlice((state) => state.founding);
export const useWallet = () => useSlice((state) => state.wallet);
export const useMint = () => useSlice((state) => state.mint);
/** The sale still has citizens and this wallet has not reached its limit. */
export const useCanMint = () =>
  useSlice((state) => state.mint.minted < state.mint.maxSupply && state.mint.mintedByWallet < state.mint.limitPerWallet);
export const useMintCitizen = () => useSlice((state) => state.mintCitizen);
export const useHistoryMap = () => useSlice((state) => state.history);
export const useMissions = () => useSlice((state) => state.missions);
export const useMissionProgress = () => useSlice((state) => state.missionProgress);
export const useSeason = () => useSlice((state) => state.season);
export const useMarket = () => useSlice((state) => state.market);
export const useTrainingConfig = () => useSlice((state) => state.trainingConfig);
export const useBusy = () => useSlice((state) => state.busy);
export const useDataMode = () => useSlice((state) => state.source.mode);
/** The chat port of the data source; absent in the mock preview. */
export const useChatPort = () => useSlice((state) => state.source.chat);
export const useChatLog = (citizenId: number): readonly ChatLine[] => useSlice((state) => state.chatLogs[citizenId] ?? NO_LINES);
export const useCitizenReaction = (citizenId: number): CitizenReaction | undefined => useSlice((state) => state.reactions[citizenId]);
export const useChatLogActions = () => {
  const addChatLine = useSlice((state) => state.addChatLine);
  const removeChatLine = useSlice((state) => state.removeChatLine);
  const clearChatLog = useSlice((state) => state.clearChatLog);
  const react = useSlice((state) => state.react);
  return { addChatLine, removeChatLine, clearChatLog, react };
};

export function useCitizen(id: number): CitizenRecord | undefined {
  return useSlice((state) => state.citizens.find((citizen) => citizen.id === id));
}

/** The citizen the city, the profile and training act on. */
export function useSelectedCitizen(): CitizenRecord | undefined {
  return useSlice(
    (state) => state.citizens.find((citizen) => citizen.id === state.selectedCitizenId) ?? state.citizens[0],
  );
}

/** The listing of a citizen, or `undefined` while it is not for sale. */
export function useListing(id: number): MarketListing | undefined {
  return useSlice((state) => state.market.listings.find((listing) => listing.citizenId === id));
}

/** The auction of a citizen, or `undefined` while it is not up for auction. */
export function useAuction(id: number): MarketAuction | undefined {
  return useSlice((state) => state.market.auctions.find((auction) => auction.citizenId === id));
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
export const useFocus = () => useSlice((state) => state.focus);
export const useSetFocus = () => useSlice((state) => state.setFocus);

/** Actions are stable references, safe to select individually. */
export const useSelectCitizen = () => useSlice((state) => state.selectCitizen);
export const useTrainStat = () => useSlice((state) => state.trainStat);
export const useStartMission = () => useSlice((state) => state.startMission);
export const useAdvanceMission = () => useSlice((state) => state.advanceMission);
export const useNextDay = () => useSlice((state) => state.nextDay);
export const useAbandonMission = () => useSlice((state) => state.abandonMission);
export const useListCitizen = () => useSlice((state) => state.listCitizen);
export const useChangeListingPrice = () => useSlice((state) => state.changeListingPrice);
export const useCancelListing = () => useSlice((state) => state.cancelListing);
export const useBuyCitizen = () => useSlice((state) => state.buyCitizen);
export const useSimulateSale = () => useSlice((state) => state.simulateSale);
export const useAuctionCitizen = () => useSlice((state) => state.auctionCitizen);
export const usePlaceBid = () => useSlice((state) => state.placeBid);
export const useCancelAuction = () => useSlice((state) => state.cancelAuction);
export const useSettleAuction = () => useSlice((state) => state.settleAuction);
export const useSimulateBid = () => useSlice((state) => state.simulateBid);
export const useSimulateAuctionEnd = () => useSlice((state) => state.simulateAuctionEnd);
export const useSetCityMode = () => useSlice((state) => state.setCityMode);
export const useRequestZoom = () => useSlice((state) => state.requestZoom);
export const useMissionPrompt = () => useSlice((state) => state.missionPrompt);
export const useDismissMissionPrompt = () => useSlice((state) => state.dismissMissionPrompt);
export const useReopenMissionPrompt = () => useSlice((state) => state.reopenMissionPrompt);
export const useRequestFocus = () => useSlice((state) => state.requestFocus);
export const useRequestWalk = () => useSlice((state) => state.requestWalk);
export const useOpenWallet = () => useSlice((state) => state.openWallet);
export const useWalletDialog = () => useSlice((state) => state.walletDialog);
export const useCloseWalletDialog = () => useSlice((state) => state.closeWalletDialog);
export const useToggleSfx = () => useSlice((state) => state.toggleSfx);
export const useReward = () => useSlice((state) => state.reward);
export const useCloseReward = () => useSlice((state) => state.closeReward);
export const useCloseModal = () => useSlice((state) => state.closeModal);
