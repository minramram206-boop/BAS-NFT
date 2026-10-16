import type { CitizenRecord, StatKey } from '@bas/content';
import { MAX_STAT_SCORE } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { AUCTION_HOURS, endAfterBid, minNextBid, priceProblem, splitSale, suggestedBid } from '../market';
import { MISSION_POINTS, startBlocker } from '../missions';
import type {
  DistrictActionError,
  MarketAuction,
  MarketSale,
  DistrictActionResult,
  DistrictDataSource,
  DistrictSnapshot,
  HistoryEntry,
  MintActionResult,
  SeasonSnapshot,
  StepProof,
} from '../types';
import { MOCK_ANSWERS, createMockSnapshot } from './mockSnapshot';

export interface MockDataSourceOptions {
  roster: readonly CitizenRecord[];
  /** `baseTrainingCostAtoms` from the cluster manifest. */
  baseTrainingCostAtoms: string;
  /** `mintPriceLamports` from the cluster manifest, a decimal string. */
  mintPriceLamports: string;
  /** `mintLimitPerWallet` from the cluster manifest. */
  mintLimitPerWallet: number;
  /** `empty` starts a wallet without any citizen. */
  start?: 'owned' | 'empty';
  /** Source of the mint draw; tests pass a fixed one. */
  random?: () => number;
  /** Milliseconds; tests replace it to run auctions to their end. */
  clock?: () => number;
}

/** Wallets of the other players who bid in the preview. */
const OTHER_BIDDERS = ['Kx3p…9Qe', 'Bn7w…T2s', 'Hd4r…L8m'] as const;

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** Adds season points to every leaderboard row of a citizen and keeps the rows ranked. */
function withPoints(season: SeasonSnapshot, citizenId: number, points: number): SeasonSnapshot {
  const leaderboards = Object.fromEntries(
    Object.entries(season.leaderboards).map(([bracket, rows]) => [
      bracket,
      (rows ?? [])
        .map((row) => (row.citizenId === citizenId ? { ...row, points: row.points + points } : row))
        .sort((a, b) => b.points - a.points),
    ]),
  );
  return { ...season, leaderboards };
}

/**
 * Runs the district program's checks on local state. Nothing is signed or
 * sent; the order of the checks matches `upgrade_score` and
 * `claim_training_credit` so the screens meet the same refusals later.
 */
export function createMockDataSource(options: MockDataSourceOptions): DistrictDataSource {
  const clock = options.clock ?? Date.now;
  const now = () => Math.floor(clock() / 1000);
  let state: DistrictSnapshot = createMockSnapshot(options.roster, options.baseTrainingCostAtoms, {
    mintPriceLamports: BigInt(options.mintPriceLamports),
    mintLimitPerWallet: options.mintLimitPerWallet,
    ...(options.start ? { start: options.start } : {}),
    nowSeconds: now(),
  });
  const random = options.random ?? Math.random;
  let noticeId = 0;
  let saleId = 0;
  const today = () => state.season.day;

  const fail = (error: DistrictActionError) => ({ ok: false, error }) as const;
  const commit = (next: DistrictSnapshot): DistrictActionResult => {
    state = next;
    return { ok: true, snapshot: state };
  };
  const pushHistory = (citizenId: number, entry: HistoryEntry) => ({
    ...state.history,
    [citizenId]: [entry, ...(state.history[citizenId] ?? [])],
  });
  const listingOf = (citizenId: number) => state.market.listings.find((listing) => listing.citizenId === citizenId);
  const withListings = (listings: DistrictSnapshot['market']['listings']) => ({ ...state.market, listings });
  const auctionOf = (citizenId: number) => state.market.auctions.find((auction) => auction.citizenId === citizenId);
  const isMine = (auction: MarketAuction) => auction.seller === state.wallet.label;
  const replaceAuction = (citizenId: number, next: MarketAuction | null) => {
    const others = state.market.auctions.filter((auction) => auction.citizenId !== citizenId);
    return next ? [...others, next] : others;
  };
  const withNotice = (notice: DistrictSnapshot['market']['notices'][number] | null) =>
    notice ? [notice, ...state.market.notices] : state.market.notices;
  /** A finished sale, on top of the market's list. */
  const withSale = (sale: Omit<MarketSale, 'id' | 'at' | 'sellerIsMe' | 'buyerIsMe'>) => {
    saleId += 1;
    const me = state.wallet.label;
    return [
      { ...sale, id: `mock-sale-${saleId}`, at: now(), sellerIsMe: sale.seller === me, buyerIsMe: sale.buyer === me },
      ...state.market.sales,
    ];
  };
  /** A citizen that changed hands keeps its registration in its public history, then gains the sale. */
  const soldHistory = (citizenId: number, priceLamports: bigint) => ({
    ...state.history,
    [citizenId]: [
      { day: today(), kind: 'sale', priceLamports } as const,
      ...(state.history[citizenId] ?? [{ day: 1, kind: 'register' } as const]),
    ],
  });

  return {
    mode: 'mock',

    snapshot: () => state,

    async mintCitizen(): Promise<MintActionResult> {
      // The wallet's own limit is checked first, as the Candy Guard does, then what is left to draw from.
      if (state.mint.mintedByWallet >= state.mint.limitPerWallet) return fail('mint-limit');
      const left = options.roster.filter((citizen) => !state.citizens.some((minted) => minted.id === citizen.id));
      const drawn = left[Math.floor(random() * left.length)];
      if (!drawn) return fail('sold-out');
      if (state.wallet.solLamports < state.mint.priceLamports) return fail('insufficient-sol');

      // The role and its starting scores come with the NFT, so the record is taken as authored.
      const citizen = { ...drawn, registered: true };
      const result = commit({
        ...state,
        wallet: { ...state.wallet, solLamports: state.wallet.solLamports - state.mint.priceLamports },
        mint: { ...state.mint, minted: state.mint.minted + 1, mintedByWallet: state.mint.mintedByWallet + 1 },
        citizens: [...state.citizens, citizen],
        credits: { ...state.credits, [citizen.id]: { intelligence: 0, alignment: 0, compute: 0 } },
        owned: [...state.owned, citizen.id],
        history: { ...state.history, [citizen.id]: [{ day: today(), kind: 'register' }] },
      });
      return result.ok ? { ok: true, snapshot: result.snapshot, citizenId: citizen.id } : result;
    },

    async upgradeScore(citizenId: number, stat: StatKey) {
      const citizen = state.citizens.find((item) => item.id === citizenId);
      if (!citizen || !state.owned.includes(citizenId)) return fail('not-owner');
      const score = citizen[stat];
      if (score >= MAX_STAT_SCORE) return fail('stat-at-max');
      const credits = state.credits[citizenId];
      if (!credits || credits[stat] < 1) return fail('no-credit');
      const cost = trainingCostAtoms(options.baseTrainingCostAtoms, score);
      if (state.wallet.tokenAtoms < cost) return fail('insufficient-balance');

      return commit({
        ...state,
        wallet: { ...state.wallet, tokenAtoms: state.wallet.tokenAtoms - cost },
        citizens: state.citizens.map((item) => (item.id === citizenId ? { ...item, [stat]: score + 1 } : item)),
        credits: { ...state.credits, [citizenId]: { ...credits, [stat]: credits[stat] - 1 } },
        history: pushHistory(citizenId, { day: today(), kind: 'train', stat, from: score, burnedAtoms: cost }),
      });
    },

    async startMission(citizenId: number, missionId: string, stat: StatKey) {
      const citizen = state.citizens.find((item) => item.id === citizenId);
      const mission = state.missions.find((item) => item.id === missionId);
      if (!citizen) return fail('not-owner');
      if (!mission) return fail('mission-closed');
      const blocker = startBlocker(state, citizen, mission);
      if (blocker) return fail(blocker);
      if (!mission.rewards.includes(stat)) return fail('invalid-stat');
      return commit({
        ...state,
        missionProgress: { ...state.missionProgress, [missionId]: { citizenId, done: 0, stat } },
      });
    },

    async advanceMission(citizenId: number, missionId: string, proof: StepProof) {
      const mission = state.missions.find((item) => item.id === missionId);
      const progress = state.missionProgress[missionId];
      if (!state.owned.includes(citizenId)) return fail('not-owner');
      if (!mission || !progress) return fail('mission-closed');
      if (progress.citizenId !== citizenId) return fail('mission-busy');
      const step = mission.steps[progress.done];
      if (!step || step.kind !== proof.kind) return fail('mission-closed');
      if (step.kind === 'talk' && proof.kind === 'talk' && MOCK_ANSWERS[missionId]?.[progress.done] !== proof.answer) {
        return fail('wrong-answer');
      }
      if (step.kind === 'puzzle' && proof.kind === 'puzzle' && !proof.order.every((piece, position) => piece === position)) {
        return fail('wrong-order');
      }

      const done = progress.done + 1;
      if (done < mission.steps.length) {
        return commit({ ...state, missionProgress: { ...state.missionProgress, [missionId]: { ...progress, done } } });
      }

      const { stat } = progress;
      const credits = state.credits[citizenId] ?? { intelligence: 0, alignment: 0, compute: 0 };
      return commit({
        ...state,
        missionProgress: without(state.missionProgress, missionId),
        credits: { ...state.credits, [citizenId]: { ...credits, [stat]: credits[stat] + 1 } },
        history: pushHistory(citizenId, { day: today(), kind: 'mission', missionId, stat }),
        season: withPoints(state.season, citizenId, MISSION_POINTS),
      });
    },

    async abandonMission(missionId: string) {
      return commit({ ...state, missionProgress: without(state.missionProgress, missionId) });
    },

    async listCitizen(citizenId: number, priceLamports: bigint) {
      if (!state.market.open) return fail('market-closed');
      if (!state.owned.includes(citizenId)) return fail('not-owner');
      if (listingOf(citizenId)) return fail('already-listed');
      if (auctionOf(citizenId)) return fail('in-auction');
      if (priceProblem(priceLamports, state.market)) return fail('invalid-price');
      const listing = { citizenId, seller: state.wallet.label, priceLamports, listedDay: today() };
      return commit({ ...state, market: withListings([...state.market.listings, listing]) });
    },

    async changeListingPrice(citizenId: number, priceLamports: bigint) {
      if (!state.market.open) return fail('market-closed');
      if (!state.owned.includes(citizenId)) return fail('not-owner');
      if (!listingOf(citizenId)) return fail('not-listed');
      if (priceProblem(priceLamports, state.market)) return fail('invalid-price');
      return commit({
        ...state,
        market: withListings(
          state.market.listings.map((listing) => (listing.citizenId === citizenId ? { ...listing, priceLamports } : listing)),
        ),
      });
    },

    async cancelListing(citizenId: number) {
      if (!state.market.open) return fail('market-closed');
      if (!state.owned.includes(citizenId)) return fail('not-owner');
      if (!listingOf(citizenId)) return fail('not-listed');
      return commit({ ...state, market: withListings(state.market.listings.filter((listing) => listing.citizenId !== citizenId)) });
    },

    async buyCitizen(citizenId: number) {
      if (!state.market.open) return fail('market-closed');
      const listing = listingOf(citizenId);
      if (!listing) return fail('listing-gone');
      if (state.owned.includes(citizenId)) return fail('own-listing');
      if (state.wallet.solLamports < listing.priceLamports) return fail('insufficient-sol');
      return commit({
        ...state,
        wallet: { ...state.wallet, solLamports: state.wallet.solLamports - listing.priceLamports },
        owned: [...state.owned, citizenId],
        history: soldHistory(citizenId, listing.priceLamports),
        market: {
          ...withListings(state.market.listings.filter((item) => item.citizenId !== citizenId)),
          sales: withSale({ citizenId, kind: 'fixed', priceLamports: listing.priceLamports, seller: listing.seller, buyer: state.wallet.label, bids: [] }),
        },
      });
    },

    async simulateSale(citizenId: number) {
      const listing = listingOf(citizenId);
      if (!listing || !state.owned.includes(citizenId)) return fail('not-listed');
      const { proceedsLamports } = splitSale(listing.priceLamports, state.market.royaltyBps);
      return commit({
        ...state,
        wallet: { ...state.wallet, solLamports: state.wallet.solLamports + proceedsLamports },
        owned: state.owned.filter((id) => id !== citizenId),
        // A mission is played with the citizen of the moment; the new owner starts none of the old owner's.
        missionProgress: Object.fromEntries(
          Object.entries(state.missionProgress).filter(([, progress]) => progress.citizenId !== citizenId),
        ),
        history: soldHistory(citizenId, listing.priceLamports),
        market: {
          ...withListings(state.market.listings.filter((item) => item.citizenId !== citizenId)),
          sales: withSale({ citizenId, kind: 'fixed', priceLamports: listing.priceLamports, seller: state.wallet.label, buyer: 'Kx3p…9Qe', bids: [] }),
        },
      });
    },

    async auctionCitizen(citizenId: number, startPriceLamports: bigint, durationHours: number) {
      if (!state.market.open) return fail('market-closed');
      if (!state.owned.includes(citizenId)) return fail('not-owner');
      if (listingOf(citizenId)) return fail('already-listed');
      if (auctionOf(citizenId)) return fail('in-auction');
      if (priceProblem(startPriceLamports, state.market) || !AUCTION_HOURS.includes(durationHours)) return fail('invalid-price');
      const auction: MarketAuction = {
        citizenId,
        seller: state.wallet.label,
        startPriceLamports,
        highestBidLamports: null,
        bidCount: 0,
        bids: [],
        endsAt: now() + durationHours * state.market.auctionClock.hourSeconds,
        minBidLamports: startPriceLamports,
        leading: false,
        deliverable: true,
      };
      return commit({ ...state, market: { ...state.market, auctions: replaceAuction(citizenId, auction) } });
    },

    async placeBid(citizenId: number, amountLamports: bigint) {
      if (!state.market.open) return fail('market-closed');
      const auction = auctionOf(citizenId);
      if (!auction) return fail('listing-gone');
      if (now() >= auction.endsAt) return fail('auction-ended');
      if (isMine(auction)) return fail('own-listing');
      if (auction.leading) return fail('already-highest');
      if (amountLamports < auction.minBidLamports) return fail('bid-too-low');
      if (amountLamports > state.market.maxPriceLamports) return fail('invalid-price');
      if (state.wallet.solLamports < amountLamports) return fail('insufficient-sol');
      // The bid leaves the wallet now; the previous bidder (another player here) is paid back.
      return commit({
        ...state,
        wallet: { ...state.wallet, solLamports: state.wallet.solLamports - amountLamports },
        market: {
          ...state.market,
          auctions: replaceAuction(citizenId, {
            ...auction,
            highestBidLamports: amountLamports,
            bidCount: auction.bidCount + 1,
            bids: [{ bidder: state.wallet.label, amountLamports, at: now(), mine: true }, ...auction.bids],
            endsAt: endAfterBid(auction.endsAt, now(), state.market.auctionClock),
            minBidLamports: minNextBid(auction.startPriceLamports, amountLamports),
            leading: true,
          }),
        },
      });
    },

    async cancelAuction(citizenId: number) {
      const auction = auctionOf(citizenId);
      if (!auction || !isMine(auction)) return fail('not-listed');
      if (auction.bidCount > 0) return fail('auction-has-bids');
      return commit({ ...state, market: { ...state.market, auctions: replaceAuction(citizenId, null) } });
    },

    async settleAuction(citizenId: number) {
      const auction = auctionOf(citizenId);
      if (!auction) return fail('listing-gone');
      if (now() < auction.endsAt) return fail('auction-live');
      const price = auction.highestBidLamports;
      if (price === null) return commit({ ...state, market: { ...state.market, auctions: replaceAuction(citizenId, null) } });
      const winner = auction.leading ? state.wallet.label : (auction.bids[0]?.bidder ?? 'Kx3p…9Qe');
      const market = {
        ...state.market,
        auctions: replaceAuction(citizenId, null),
        sales: withSale({ citizenId, kind: 'auction', priceLamports: price, seller: auction.seller, buyer: winner, bids: auction.bids }),
      };
      if (isMine(auction)) {
        const { proceedsLamports } = splitSale(price, state.market.royaltyBps);
        return commit({
          ...state,
          wallet: { ...state.wallet, solLamports: state.wallet.solLamports + proceedsLamports },
          owned: state.owned.filter((id) => id !== citizenId),
          missionProgress: Object.fromEntries(
            Object.entries(state.missionProgress).filter(([, progress]) => progress.citizenId !== citizenId),
          ),
          history: soldHistory(citizenId, price),
          market,
        });
      }
      if (auction.leading) {
        return commit({ ...state, owned: [...state.owned, citizenId], history: soldHistory(citizenId, price), market });
      }
      // Another player won; the citizen moves between two other wallets.
      return commit({ ...state, history: soldHistory(citizenId, price), market });
    },

    async simulateBid(citizenId: number) {
      const auction = auctionOf(citizenId);
      if (!auction) return fail('listing-gone');
      if (now() >= auction.endsAt) return fail('auction-ended');
      const amount = suggestedBid(auction.minBidLamports);
      // When the wallet led, its bid comes back in full, as the program pays it back in the same instruction.
      const refund = auction.leading && auction.highestBidLamports !== null ? auction.highestBidLamports : 0n;
      noticeId += 1;
      return commit({
        ...state,
        wallet: { ...state.wallet, solLamports: state.wallet.solLamports + refund },
        market: {
          ...state.market,
          auctions: replaceAuction(citizenId, {
            ...auction,
            highestBidLamports: amount,
            bidCount: auction.bidCount + 1,
            bids: [{ bidder: OTHER_BIDDERS[noticeId % OTHER_BIDDERS.length] ?? 'Kx3p…9Qe', amountLamports: amount, at: now(), mine: false }, ...auction.bids],
            endsAt: endAfterBid(auction.endsAt, now(), state.market.auctionClock),
            minBidLamports: minNextBid(auction.startPriceLamports, amount),
            leading: false,
          }),
          notices: withNotice(refund > 0n ? { id: `mock-outbid-${noticeId}`, kind: 'outbid', citizenId, refundedLamports: refund } : null),
        },
      });
    },

    async simulateAuctionEnd(citizenId: number) {
      const auction = auctionOf(citizenId);
      if (!auction) return fail('listing-gone');
      return commit({ ...state, market: { ...state.market, auctions: replaceAuction(citizenId, { ...auction, endsAt: now() }) } });
    },

    async nextDay() {
      const { season } = state;
      if (season.day >= season.length) return fail('mission-closed');
      return commit({ ...state, season: { ...season, day: season.day + 1 } });
    },
  };
}
