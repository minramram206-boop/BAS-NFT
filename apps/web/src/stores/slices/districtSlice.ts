import type { StatKey } from '@bas/content';
import { tierUpOf } from '@/lib/data/journey';
import { DAILY_MISSION_CREDITS, missionPoints, missionsToday } from '@/lib/data/missions';
import { createChainDataSource } from '@/lib/data/chain/chainDataSource';
import { createReads, kitReadRpc } from '@/lib/data/chain/reads';
import { createTransactions, kitSendRpc } from '@/lib/data/chain/transactions';
import type { ChainDataSource } from '@/lib/data/chain/types';
import { createMockDataSource } from '@/lib/data/mock/mockDataSource';
import type {
  DistrictActionError,
  DistrictActionResult,
  DistrictDataSource,
  DistrictSnapshot,
  MissionDefinition,
  StepProof,
} from '@/lib/data/types';
import { auctionClockOf, auctionStage, clockSpan, formatSolExact, myOffer, offerSpanText, splitSale } from '@/lib/data/market';
import { districtName } from '@/lib/format';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';
import { spawnFloatingStatEffect } from '@/lib/effects/floatingStatEffect';
import { MESSAGES, formatMessage } from '@/messages';
import type { CreateBasStoreOptions, DistrictSlice, GetState, SetState } from '../types';

function fromSnapshot(snapshot: DistrictSnapshot) {
  return { ...snapshot, citizens: [...snapshot.citizens] };
}

/** The citizen to show: the current one while it still exists, else the first one the wallet owns. */
function pickSelected(snapshot: DistrictSnapshot, current: number): number {
  if (snapshot.owned.includes(current)) return current;
  return snapshot.owned[0] ?? (snapshot.citizens.some((item) => item.id === current) ? current : snapshot.citizens[0]?.id ?? 0);
}

function createSource(options: CreateBasStoreOptions): DistrictDataSource {
  const { chain } = options;
  if (!chain) {
    return createMockDataSource({
      roster: options.citizens,
      baseTrainingCostAtoms: options.trainingConfig.baseTrainingCostAtoms,
      mintPriceLamports: options.mintPriceLamports,
      mintLimitPerWallet: options.mintLimitPerWallet,
      // Dev switch: `NEXT_PUBLIC_BAS_MOCK_START=empty` starts a wallet that owns no citizen.
      start: process.env.NEXT_PUBLIC_BAS_MOCK_START === 'empty' ? 'empty' : 'owned',
    });
  }
  return createChainDataSource({
    roster: options.citizens,
    reads: createReads({
      rpc: kitReadRpc(chain.rpcUrl),
      programId: chain.programId,
      collection: chain.collection,
      utilityMint: chain.utilityMint,
      candyMachine: chain.candyMachine,
      ...(chain.marketProgramId ? { marketProgramId: chain.marketProgramId } : {}),
    }),
    transactions: createTransactions({
      rpc: kitSendRpc(chain.rpcUrl),
      programId: chain.programId,
      utilityMint: chain.utilityMint,
      ...(chain.marketProgramId ? { market: { programId: chain.marketProgramId, collection: chain.collection } } : {}),
    }),
    missionApi: { baseUrl: chain.missionServerUrl },
    chatApi: { baseUrl: chain.chatServerUrl },
    baseTrainingCostAtoms: options.trainingConfig.baseTrainingCostAtoms,
    mintPriceLamports: options.mintPriceLamports,
    mintLimitPerWallet: options.mintLimitPerWallet,
    maxSupply: chain.maxSupply,
    auctionClock: auctionClockOf(chain.auctionClock),
  });
}

/** Citizens, progress, missions and season, all read and changed through the data source. */
export function createDistrictSlice(options: CreateBasStoreOptions, set: SetState, get: GetState): DistrictSlice {
  const source = createSource(options);
  const chainSource: ChainDataSource | null = source.mode === 'chain' ? (source as ChainDataSource) : null;
  const initial = source.snapshot();

  /** Answers the dialog shows inline, so they do not open the error modal. */
  const INLINE_ERRORS: readonly DistrictActionError[] = ['wrong-answer', 'wrong-order'];

  const run = async (
    action: () => Promise<DistrictActionResult>,
    failure?: { error: DistrictActionError | null },
  ): Promise<DistrictSnapshot | null> => {
    if (get().busy) return null;
    set({ busy: true, lastError: null });
    const result = await action();
    if (!result.ok) {
      if (failure) failure.error = result.error;
      // A refused action can still have moved the source (a mission whose claim was not signed), so read it back.
      set({ ...fromSnapshot(source.snapshot()), busy: false, lastError: result.error });
      if (!INLINE_ERRORS.includes(result.error)) {
        const copy = MESSAGES.errors[result.error];
        get().openModal(copy.title, copy.message);
      }
      return null;
    }
    set({ ...fromSnapshot(result.snapshot), busy: false });
    return result.snapshot;
  };

  return {
    ...fromSnapshot(initial),
    source,
    trainingConfig: { ...options.trainingConfig },
    selectedCitizenId: pickSelected(initial, 0),
    busy: false,
    lastError: null,

    selectCitizen: (id) => {
      if (id === get().selectedCitizenId) return;
      retroAudio.play('click');
      set({ selectedCitizenId: id });
    },

    cityPick: null,
    pickFromCity: (id) => {
      set({ cityPick: id });
      if (id !== null) get().selectCitizen(id);
    },

    mintCitizen: async () => {
      const drawn: { id: number | null } = { id: null };
      const next = await run(async () => {
        const result = await source.mintCitizen();
        if (result.ok) drawn.id = result.citizenId;
        return result;
      });
      if (!next || drawn.id === null) return null;
      retroAudio.play('mint');
      set({ selectedCitizenId: drawn.id });
      return drawn.id;
    },

    trainStat: async (stat: StatKey, targetElement) => {
      const citizenId = get().selectedCitizenId;
      const before = get().citizens.find((item) => item.id === citizenId);
      const next = await run(() => source.upgradeScore(citizenId, stat));
      if (!next) return false;
      retroAudio.play('train');
      if (targetElement) spawnFloatingStatEffect(targetElement, MESSAGES.stats[stat].label);

      // Crossing 3, 6 or 10 is the moment the route opens something, so say what.
      const after = next.citizens.find((item) => item.id === citizenId);
      const tierUp = before && after ? tierUpOf(before, after, stat) : null;
      if (after && tierUp) {
        const copy = MESSAGES.journey;
        const values = { name: after.name, tier: tierUp.tier, stat: MESSAGES.stats[stat].label };
        const firstMission = next.missions.find(
          (mission) => tierUp.opened.includes(mission.district) && mission.opensInHours === undefined,
        );
        const message =
          formatMessage(copy.tierUpBody, values) +
          (tierUp.opened.length > 0
            ? formatMessage(copy.tierUpOpened, {
                ...values,
                districts: tierUp.opened.map((id) => districtName(id)).join(copy.and),
              })
            : '') +
          (firstMission
            ? formatMessage(copy.tierUpTry, { mission: MESSAGES.missions.catalog[firstMission.id as keyof typeof MESSAGES.missions.catalog].title })
            : '') +
          (tierUp.tier === 1
            ? formatMessage(copy.tierUpAchievement, {
                title: formatMessage(MESSAGES.profile.achFirstTier, { stat: values.stat }),
              })
            : '') +
          (tierUp.tier === 3 ? formatMessage(copy.tierUpMaster, values) : '');
        get().openModal(formatMessage(copy.tierUpTitle, values), message);
      }
      return true;
    },

    startMission: async (mission: MissionDefinition, stat: StatKey) => {
      const citizenId = get().selectedCitizenId;
      const next = await run(() => source.startMission(citizenId, mission.id, stat));
      if (!next) return false;
      retroAudio.play('click');
      // Walking steps are played on the map, so the citizen follows taps from here on.
      set({ cityMode: 'control' });
      return true;
    },

    advanceMission: async (mission: MissionDefinition, proof: StepProof) => {
      const citizenId = get().selectedCitizenId;
      const before = get().missionProgress[mission.id];
      const failure: { error: DistrictActionError | null } = { error: null };
      const next = await run(() => source.advanceMission(citizenId, mission.id, proof), failure);
      if (!next) return failure.error === 'wrong-answer' || failure.error === 'wrong-order' ? 'wrong' : 'refused';
      const finished = before !== undefined && next.missionProgress[mission.id] === undefined;
      retroAudio.play(finished ? 'mint' : 'click');
      if (finished) {
        const stat = before.stat;
        const citizen = next.citizens.find((item) => item.id === citizenId);
        set({
          reward: {
            citizenName: citizen?.name ?? '',
            missionId: mission.id,
            stat,
            points: missionPoints(mission),
            creditsReady: next.credits[citizenId]?.[stat] ?? 0,
            leftToday: Math.max(DAILY_MISSION_CREDITS - missionsToday(next, citizenId), 0),
          },
        });
      }
      return 'ok';
    },

    abandonMission: async (missionId: string) => {
      await run(() => source.abandonMission(missionId));
    },

    nextDay: async () => {
      const { nextDay } = source;
      if (!nextDay) return;
      await run(() => nextDay());
    },

    listCitizen: async (citizenId, priceLamports) => {
      const next = await run(() => source.listCitizen(citizenId, priceLamports));
      if (!next) return false;
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(
        MESSAGES.market.listedTitle,
        formatMessage(MESSAGES.market.listedMessage, { name, price: formatSolExact(priceLamports) }),
      );
      return true;
    },

    changeListingPrice: async (citizenId, priceLamports) => {
      const next = await run(() => source.changeListingPrice(citizenId, priceLamports));
      if (!next) return false;
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(
        MESSAGES.market.updatedTitle,
        formatMessage(MESSAGES.market.updatedMessage, { name, price: formatSolExact(priceLamports) }),
      );
      return true;
    },

    cancelListing: async (citizenId) => {
      const next = await run(() => source.cancelListing(citizenId));
      if (!next) return false;
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(MESSAGES.market.cancelledTitle, formatMessage(MESSAGES.market.cancelledMessage, { name }));
      return true;
    },

    buyCitizen: async (citizenId) => {
      const next = await run(() => source.buyCitizen(citizenId));
      if (!next) return false;
      retroAudio.play('mint');
      set({ selectedCitizenId: citizenId });
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(MESSAGES.market.boughtTitle, formatMessage(MESSAGES.market.boughtMessage, { name }));
      return true;
    },

    simulateSale: async (citizenId) => {
      const { simulateSale } = source;
      if (!simulateSale) return;
      const listing = get().market.listings.find((item) => item.citizenId === citizenId);
      const name = get().citizens.find((item) => item.id === citizenId)?.name ?? '';
      const next = await run(() => simulateSale(citizenId));
      if (!next || !listing) return;
      retroAudio.play('mint');
      // The citizen left the wallet, so the screens must not keep acting on it.
      set({ selectedCitizenId: pickSelected(next, get().selectedCitizenId) });
      get().openModal(
        MESSAGES.market.soldTitle,
        formatMessage(MESSAGES.market.soldMessage, {
          name,
          price: formatSolExact(listing.priceLamports),
          amount: formatSolExact(splitSale(listing.priceLamports, next.market.royaltyBps).proceedsLamports),
        }),
      );
    },

    auctionCitizen: async (citizenId, startPriceLamports, durationHours) => {
      const next = await run(() => source.auctionCitizen(citizenId, startPriceLamports, durationHours));
      if (!next) return false;
      retroAudio.play('click');
      // The market holds the citizen now, so another one of the wallet's takes the stage.
      set({ selectedCitizenId: pickSelected(next, get().selectedCitizenId) });
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(
        MESSAGES.market.auctionStartedTitle,
        formatMessage(MESSAGES.market.auctionStartedMessage, {
          name,
          price: formatSolExact(startPriceLamports),
          time: clockSpan(durationHours * next.market.auctionClock.hourSeconds),
        }),
      );
      return true;
    },

    placeBid: async (citizenId, amountLamports) => {
      const next = await run(() => source.placeBid(citizenId, amountLamports));
      if (!next) return false;
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(
        MESSAGES.market.bidPlacedTitle,
        formatMessage(MESSAGES.market.bidPlacedMessage, { name, price: formatSolExact(amountLamports) }),
      );
      return true;
    },

    cancelAuction: async (citizenId) => {
      const next = await run(() => source.cancelAuction(citizenId));
      if (!next) return false;
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(MESSAGES.market.auctionCancelledTitle, formatMessage(MESSAGES.market.auctionCancelledMessage, { name }));
      return true;
    },

    settleAuction: async (citizenId) => {
      const auction = get().market.auctions.find((item) => item.citizenId === citizenId);
      const name = get().citizens.find((item) => item.id === citizenId)?.name ?? '';
      // The wallet's part in the auction is read before it is settled: afterwards the auction is gone.
      const stage = auction ? auctionStage(auction, Math.floor(Date.now() / 1000)) : null;
      const next = await run(() => source.settleAuction(citizenId));
      if (!next || !auction) return Boolean(next);
      const copy = MESSAGES.market;
      const price = auction.highestBidLamports;
      if (price === null) {
        retroAudio.play('click');
        get().openModal(copy.noBidTitle, formatMessage(copy.noBidMessage, { name }));
      } else if (!auction.deliverable) {
        retroAudio.play('click');
        get().openModal(copy.refundedTitle, formatMessage(copy.refundedMessage, { name }));
      } else if (next.owned.includes(citizenId) && auction.leading) {
        retroAudio.play('mint');
        set({ selectedCitizenId: citizenId });
        get().openModal(copy.wonTitle, formatMessage(copy.wonMessage, { name, price: formatSolExact(price) }));
      } else if (stage === 'collect') {
        retroAudio.play('mint');
        set({ selectedCitizenId: pickSelected(next, get().selectedCitizenId) });
        get().openModal(
          copy.collectedTitle,
          formatMessage(copy.collectedMessage, {
            name,
            price: formatSolExact(price),
            amount: formatSolExact(splitSale(price, next.market.royaltyBps).proceedsLamports),
          }),
        );
      } else {
        retroAudio.play('mint');
        set({ selectedCitizenId: pickSelected(next, get().selectedCitizenId) });
        get().openModal(copy.finishedTitle, formatMessage(copy.finishedMessage, { name, price: formatSolExact(price) }));
      }
      return true;
    },

    simulateBid: async (citizenId) => {
      const { simulateBid } = source;
      if (!simulateBid) return;
      const next = await run(() => simulateBid(citizenId));
      if (next) retroAudio.play('click');
    },

    simulateAuctionEnd: async (citizenId) => {
      const { simulateAuctionEnd } = source;
      if (!simulateAuctionEnd) return;
      await run(() => simulateAuctionEnd(citizenId));
    },

    makeOffer: async (citizenId, amountLamports, days) => {
      const next = await run(() => source.makeOffer(citizenId, amountLamports, days));
      if (!next) return false;
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(
        MESSAGES.market.offerMadeTitle,
        formatMessage(MESSAGES.market.offerMadeMessage, {
          name,
          price: formatSolExact(amountLamports),
          time: offerSpanText(days, next.market.auctionClock),
        }),
      );
      return true;
    },

    withdrawOffer: async (citizenId) => {
      const offer = myOffer(get().market.offers, citizenId);
      const next = await run(() => source.withdrawOffer(citizenId));
      if (!next || !offer) return Boolean(next);
      retroAudio.play('click');
      const name = next.citizens.find((item) => item.id === citizenId)?.name ?? '';
      get().openModal(
        MESSAGES.market.offerWithdrawnTitle,
        formatMessage(MESSAGES.market.offerWithdrawnMessage, { name, price: formatSolExact(offer.amountLamports) }),
      );
      return true;
    },

    acceptOffer: async (citizenId, offerId) => {
      const offer = get().market.offers.find((item) => item.id === offerId);
      const name = get().citizens.find((item) => item.id === citizenId)?.name ?? '';
      const next = await run(() => source.acceptOffer(citizenId, offerId));
      if (!next || !offer) return Boolean(next);
      retroAudio.play('mint');
      // The citizen left the wallet, so the screens must not keep acting on it.
      set({ selectedCitizenId: pickSelected(next, get().selectedCitizenId) });
      get().openModal(
        MESSAGES.market.offerAcceptedTitle,
        formatMessage(MESSAGES.market.offerAcceptedMessage, {
          name,
          buyer: offer.buyer,
          price: formatSolExact(offer.amountLamports),
          amount: formatSolExact(splitSale(offer.amountLamports, next.market.royaltyBps).proceedsLamports),
        }),
      );
      return true;
    },

    closeExpiredOffers: async (citizenId) => {
      const next = await run(() => source.closeExpiredOffers(citizenId));
      if (next) retroAudio.play('click');
      return Boolean(next);
    },

    simulateOffer: async (citizenId) => {
      const { simulateOffer } = source;
      if (!simulateOffer) return;
      const next = await run(() => simulateOffer(citizenId));
      if (next) retroAudio.play('click');
    },

    simulateOfferAccepted: async (citizenId) => {
      const { simulateOfferAccepted } = source;
      if (!simulateOfferAccepted) return;
      const next = await run(() => simulateOfferAccepted(citizenId));
      if (!next) return;
      // Told the way a real acceptance is: by the market notice the wallet finds next.
      retroAudio.play('mint');
      set({ selectedCitizenId: citizenId });
    },

    connectWallet: async (session) => {
      if (!chainSource) return;
      set({ busy: true });
      const result = await chainSource.setWallet(session);
      const snapshot = chainSource.snapshot();
      set({ ...fromSnapshot(snapshot), selectedCitizenId: pickSelected(snapshot, get().selectedCitizenId), busy: false });
      if (!result.ok) {
        const copy = MESSAGES.errors[result.error];
        get().openModal(copy.title, copy.message);
      }
    },

    refreshData: async () => {
      if (!chainSource || get().busy) return;
      const result = await chainSource.refresh();
      if (!result.ok || get().busy) return;
      const snapshot = result.snapshot;
      set({ ...fromSnapshot(snapshot), selectedCitizenId: pickSelected(snapshot, get().selectedCitizenId) });
    },

    clearError: () => set({ lastError: null }),
  };
}
