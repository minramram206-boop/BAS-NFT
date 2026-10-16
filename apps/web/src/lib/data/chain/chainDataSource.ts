import type { CitizenRecord, StatKey } from '@bas/content';
import { MAX_STAT_SCORE } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import type { AuctionClock } from '@bas/chain-client/browser';
import { ChatPortError, type CitizenChatPort } from '../chat';
import { bracketOf } from '../districts';
import { AUCTION_CLOCKS, AUCTION_HOURS, CLOSED_MARKET, MAX_PRICE_LAMPORTS, MIN_PRICE_LAMPORTS, minNextBid, priceProblem } from '../market';
import { MISSION_CATALOG } from '../missionCatalog';
import { startBlocker } from '../missions';
import { POOL_RULES } from '../season';
import type {
  BracketId,
  DistrictActionError,
  DistrictActionResult,
  DistrictSnapshot,
  HistoryEntry,
  LeaderboardEntry,
  MarketAuction,
  MarketBid,
  MarketListing,
  MarketNotice,
  MarketSale,
  MarketSnapshot,
  MissionDefinition,
  MissionProgress,
  StatCredits,
  StepProof,
} from '../types';
import { ChatApi } from './chatApi';
import {
  MissionApi,
  MissionApiError,
  fromBase64,
  type MarketActivity,
  type MissionStatus,
  type SeasonInfo,
  type Standing,
} from './missionApi';
import { TransactionFailedError } from './transactions';
import {
  WalletDeclinedError,
  type Balances,
  type ChainCitizen,
  type ChainDataSource,
  type DistrictReads,
  type DistrictTransactions,
  type MarketReading,
  type SaleReading,
  type WalletSession,
} from './types';

export interface ChainDataSourceOptions {
  readonly roster: readonly CitizenRecord[];
  readonly reads: DistrictReads;
  readonly transactions: DistrictTransactions;
  readonly missionApi: { readonly baseUrl: string; readonly fetch?: typeof fetch };
  /** The chat server. Without it the data source offers no chat. */
  readonly chatApi?: { readonly baseUrl: string; readonly fetch?: typeof fetch };
  /** `baseTrainingCostAtoms` from the cluster manifest. */
  readonly baseTrainingCostAtoms: string;
  /** `mintPriceLamports` from the cluster manifest, a decimal string. */
  readonly mintPriceLamports: string;
  readonly mintLimitPerWallet: number;
  /** `maxSupply` from the cluster manifest; the Candy Machine's own count replaces it once the sale is readable. */
  readonly maxSupply: number;
  /** The clock the deployed market runs auctions on, from the manifest's `auctionClock`. */
  readonly auctionClock?: AuctionClock;
  /** Milliseconds; replaced in tests. */
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** How often the server is asked to count a claim whose receipt it cannot see yet. */
const CONFIRM_ATTEMPTS = 6;
const CONFIRM_WAIT_MS = 1_500;
/** How often the cluster is read for a citizen that was just minted, before giving up on seeing it. */
const MINT_VISIBLE_ATTEMPTS = 6;

const ZERO_CREDITS: StatCredits = { intelligence: 0, alignment: 0, compute: 0 };

/** Server refusals and what the screens call them. Anything not listed is `unavailable`. */
const API_ERRORS: Readonly<Record<string, DistrictActionError>> = {
  'not-connected': 'not-connected',
  'not-owner': 'not-owner',
  'citizen-not-found': 'not-owner',
  'unknown-mission': 'mission-closed',
  'invalid-stat': 'invalid-stat',
  'season-closed': 'season-closed',
  'mission-closed': 'mission-closed',
  'district-locked': 'district-locked',
  'citizen-busy': 'citizen-busy',
  'mission-cooldown': 'mission-cooldown',
  'daily-limit': 'daily-limit',
  'no-session': 'mission-closed',
  'wrong-session': 'mission-busy',
  'wrong-answer': 'wrong-answer',
  'wrong-order': 'wrong-order',
  'too-fast': 'too-fast',
  'claim-pending': 'claim-pending',
  'claim-missing': 'claim-pending',
  'sold-out': 'sold-out',
  'mint-limit': 'mint-limit',
  'mint-not-open': 'mint-not-open',
};

/** Market program refusals and what the screens call them. Anything not listed is `transaction-failed`. */
const MARKET_ERRORS: Readonly<Partial<Record<string, DistrictActionError>>> = {
  MarketPaused: 'market-closed',
  PriceOutOfRange: 'invalid-price',
  PriceUnchanged: 'invalid-price',
  NotOwner: 'not-owner',
  // The citizen moved, was delisted or sold between the read and the signature.
  ListingStale: 'listing-gone',
  DelegateMissing: 'listing-gone',
  PriceAboveLimit: 'price-changed',
  BuyerIsSeller: 'own-listing',
  AssetFrozen: 'in-auction',
  ListingExists: 'already-listed',
  BidTooLow: 'bid-too-low',
  // The highest bidder changed between the read and the signature: someone bid in the meantime.
  WrongBidder: 'bid-too-low',
  AlreadyHighestBidder: 'already-highest',
  AuctionEnded: 'auction-ended',
  AuctionNotEnded: 'auction-live',
  AuctionHasBids: 'auction-has-bids',
  AuctionUndeliverable: 'listing-gone',
};

/** The error the screens show for anything that went wrong while talking to the wallet, server or cluster. */
export function actionErrorOf(error: unknown): DistrictActionError {
  if (error instanceof WalletDeclinedError) return 'declined';
  if (error instanceof TransactionFailedError) return 'transaction-failed';
  if (error instanceof MissionApiError) return API_ERRORS[error.code] ?? 'unavailable';
  return 'unavailable';
}

const shorten = (address: string): string => `${address.slice(0, 4)}…${address.slice(-3)}`;

const SECONDS_PER_DAY = 86_400;

/**
 * The district as the chain and the mission server hold it.
 *
 * Citizens, scores and credits come from the cluster; missions, their
 * progress and the season come from the mission server. A change is only
 * reported once the cluster shows it, so what the screens draw is never a
 * guess. Every call that changes something ends with a fresh read.
 */
export function createChainDataSource(options: ChainDataSourceOptions): ChainDataSource {
  const { reads, transactions } = options;
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const roster = new Map(options.roster.map((citizen) => [citizen.id, citizen]));

  let session: WalletSession | null = null;
  const api = new MissionApi({ baseUrl: options.missionApi.baseUrl, wallet: () => session, ...(options.missionApi.fetch ? { fetch: options.missionApi.fetch } : {}) });

  let chain: readonly ChainCitizen[] = [];
  let balances: Balances = { solLamports: 0n, tokenAtoms: 0n };
  let sale: SaleReading | null = null;
  let market: MarketReading | null = null;
  let activity: MarketActivity = { sales: [], bids: [] };
  let season: SeasonInfo | null = null;
  let standings: readonly Standing[] = [];
  const statuses = new Map<string, MissionStatus>();
  /** Set when the person closed the sign-in prompt, so a refresh does not ask again on its own. */
  let signInDeclined = false;

  /** Citizens in the roster that exist on chain, by serial. */
  const bySerial = (): Map<number, ChainCitizen> => {
    const map = new Map<number, ChainCitizen>();
    for (const citizen of chain) {
      if (citizen.serial !== null && roster.has(citizen.serial) && !map.has(citizen.serial)) map.set(citizen.serial, citizen);
    }
    return map;
  };

  const missionsNow = (): readonly MissionDefinition[] => {
    const seconds = Math.floor(clock() / 1000);
    const missions: MissionDefinition[] = [];
    for (const mission of MISSION_CATALOG) {
      if (!mission.event) {
        missions.push(mission);
        continue;
      }
      // An event that is not scheduled, or is over, is not listed at all.
      const window = season?.events[mission.id];
      if (!window || seconds >= window.endsAt) continue;
      missions.push(
        seconds < window.startsAt ? { ...mission, opensInHours: Math.ceil((window.startsAt - seconds) / 3_600) } : mission,
      );
    }
    return missions;
  };

  /** True while the market can still move the citizen for this listing: the seller holds it and the market is its delegate. */
  const current = (listing: MarketReading['listings'][number], citizen: ChainCitizen): boolean =>
    citizen.owner === listing.seller &&
    citizen.transferDelegate?.kind === 'address' &&
    citizen.transferDelegate.address === market?.authority;

  /** The on-chain listing of a citizen in the roster, whatever its state. */
  const listingOf = (citizenId: number) => {
    const citizen = bySerial().get(citizenId);
    const listing = citizen ? market?.listings.find((item) => item.asset === citizen.asset) : undefined;
    return citizen && listing ? { citizen, listing } : undefined;
  };

  /** The auction of a citizen in the roster, with its asset as read. */
  const auctionOf = (citizenId: number) => {
    const citizen = bySerial().get(citizenId);
    const auction = citizen ? market?.auctions.find((item) => item.asset === citizen.asset) : undefined;
    return citizen && auction ? { citizen, auction } : undefined;
  };

  const heldByMarket = (authority: ChainCitizen['transferDelegate']): boolean =>
    authority?.kind === 'address' && authority.address === market?.authority;

  /** Mirrors `Auction::can_deliver`: the seller holds the citizen, frozen by the market, and the market may move it. */
  const deliverable = (auction: MarketReading['auctions'][number], citizen: ChainCitizen): boolean =>
    citizen.owner === auction.seller && citizen.frozen && heldByMarket(citizen.freezeDelegate) && heldByMarket(citizen.transferDelegate);

  /** Season day of a Unix time, kept inside the season. */
  const dayOf = (seconds: number): number => {
    if (!season) return 1;
    return Math.min(Math.max(Math.floor((seconds - season.startsAt) / SECONDS_PER_DAY) + 1, 1), season.days);
  };

  /**
   * The bids of one auction, newest first. They come from the server's index of
   * the market, which reads the chain every few seconds, so a bid that just
   * landed may not be there yet; the auction account already names its bidder,
   * so that bid is put on top until the index catches up.
   */
  const bidsOf = (auction: MarketReading['auctions'][number]): MarketBid[] => {
    const me = session?.address ?? null;
    const read = activity.bids.filter((bid) => bid.asset === auction.asset && bid.at >= auction.startedAt);
    const bids: MarketBid[] = read.map((bid) => ({
      bidder: shorten(bid.bidder),
      amountLamports: BigInt(bid.amountLamports),
      at: bid.at,
      mine: bid.bidder === me,
    }));
    const top = read[0];
    const highestBidder = auction.highestBidder;
    if (auction.bidCount > 0 && highestBidder !== null && (top?.bidder !== highestBidder || BigInt(top.amountLamports) !== auction.highestBidLamports)) {
      bids.unshift({ bidder: shorten(highestBidder), amountLamports: auction.highestBidLamports, at: null, mine: highestBidder === me });
    }
    return bids.slice(0, auction.bidCount);
  };

  const marketNow = (minted: Map<number, ChainCitizen>): MarketSnapshot => {
    if (!market) return CLOSED_MARKET;
    const listings: MarketListing[] = [];
    for (const [serial, citizen] of minted) {
      const listing = market.listings.find((item) => item.asset === citizen.asset);
      // A frozen citizen cannot be moved, so its listing cannot be bought and is not shown.
      if (!listing || !current(listing, citizen) || citizen.frozen) continue;
      listings.push({ citizenId: serial, seller: shorten(listing.seller), priceLamports: listing.priceLamports, listedDay: dayOf(listing.listedAt) });
    }
    const auctions: MarketAuction[] = [];
    for (const [serial, citizen] of minted) {
      const auction = market.auctions.find((item) => item.asset === citizen.asset);
      if (!auction) continue;
      const highest = auction.bidCount > 0 ? auction.highestBidLamports : null;
      auctions.push({
        citizenId: serial,
        seller: shorten(auction.seller),
        startPriceLamports: auction.startPriceLamports,
        highestBidLamports: highest,
        bidCount: auction.bidCount,
        bids: bidsOf(auction),
        endsAt: auction.endsAt,
        minBidLamports: minNextBid(auction.startPriceLamports, highest),
        leading: session !== null && auction.highestBidder === session.address,
        deliverable: deliverable(auction, citizen),
      });
    }
    return {
      open: !market.config.isPaused,
      royaltyBps: market.config.royaltyBps,
      minPriceLamports: MIN_PRICE_LAMPORTS,
      maxPriceLamports: MAX_PRICE_LAMPORTS,
      listings,
      auctions,
      sales: salesNow(),
      auctionHours: AUCTION_HOURS,
      auctionClock: options.auctionClock ?? AUCTION_CLOCKS.real,
      notices: noticesNow(),
    };
  };

  /**
   * The bids of the auction a sale finished, newest first. Every bid names the
   * bidder it beat, so the chain is followed back from the winning bid to the
   * first one, which beat nobody. Bids of an earlier auction of the same
   * citizen are never part of that chain.
   */
  const bidChainOf = (sale: MarketActivity['sales'][number]): MarketBid[] => {
    const me = session?.address ?? null;
    const candidates = activity.bids.filter((bid) => bid.asset === sale.asset && bid.at <= sale.at);
    const chain: MarketActivity['bids'][number][] = [];
    let current = candidates.find((bid) => bid.bidder === sale.buyer && bid.amountLamports === sale.priceLamports);
    while (current) {
      chain.push(current);
      const beaten = current;
      if (beaten.previousBidder === null) break;
      current = candidates.find(
        (bid) =>
          bid !== beaten &&
          bid.at <= beaten.at &&
          bid.bidder === beaten.previousBidder &&
          BigInt(bid.amountLamports) < BigInt(beaten.amountLamports),
      );
    }
    return chain.map((bid) => ({ bidder: shorten(bid.bidder), amountLamports: BigInt(bid.amountLamports), at: bid.at, mine: bid.bidder === me }));
  };

  /** Finished sales of roster citizens, newest first, as the server read them. */
  const salesNow = (): MarketSale[] => {
    const me = session?.address ?? null;
    const sales: MarketSale[] = [];
    for (const sale of activity.sales) {
      const citizenId = serialOf(sale.asset);
      if (citizenId === undefined) continue;
      sales.push({
        id: sale.signature,
        citizenId,
        kind: sale.kind,
        priceLamports: BigInt(sale.priceLamports),
        seller: shorten(sale.seller),
        buyer: shorten(sale.buyer),
        sellerIsMe: sale.seller === me,
        buyerIsMe: sale.buyer === me,
        at: sale.at,
        bids: sale.kind === 'auction' ? bidChainOf(sale) : [],
      });
    }
    return sales;
  };

  /** Serial of a roster citizen by its asset address. */
  const serialOf = (asset: string): number | undefined => {
    const found = chain.find((citizen) => citizen.asset === asset);
    return found?.serial != null && roster.has(found.serial) ? found.serial : undefined;
  };

  /**
   * What happened to the connected wallet in the market: its citizens sold,
   * auctions it won, and bids that were beaten and paid back. Newest first.
   */
  const noticesNow = (): MarketNotice[] => {
    if (!session) return [];
    const me = session.address;
    const found: { at: number; notice: MarketNotice }[] = [];
    for (const sale of activity.sales) {
      const citizenId = serialOf(sale.asset);
      if (citizenId === undefined) continue;
      if (sale.seller === me) {
        found.push({
          at: sale.at,
          notice: {
            id: sale.signature,
            kind: 'sold',
            citizenId,
            priceLamports: BigInt(sale.priceLamports),
            proceedsLamports: BigInt(sale.sellerLamports),
            viaAuction: sale.kind === 'auction',
          },
        });
      } else if (sale.kind === 'auction' && sale.buyer === me) {
        found.push({ at: sale.at, notice: { id: `won-${sale.signature}`, kind: 'won', citizenId, priceLamports: BigInt(sale.priceLamports) } });
      }
    }
    // An outbid counts while it still stands: the wallet has not bid again on that auction since.
    const latestBidByAsset = new Map<string, (typeof activity.bids)[number]>();
    for (const bid of activity.bids) if (!latestBidByAsset.has(bid.asset)) latestBidByAsset.set(bid.asset, bid);
    for (const bid of activity.bids) {
      if (bid.previousBidder !== me || latestBidByAsset.get(bid.asset)?.bidder === me) continue;
      const citizenId = serialOf(bid.asset);
      if (citizenId === undefined) continue;
      if (found.some((entry) => entry.notice.kind === 'outbid' && entry.notice.citizenId === citizenId)) continue;
      const refunded = activity.bids.find((other) => other.asset === bid.asset && other.bidder === me && other.at <= bid.at);
      found.push({
        at: bid.at,
        notice: { id: bid.signature, kind: 'outbid', citizenId, refundedLamports: BigInt(refunded?.amountLamports ?? '0') },
      });
    }
    return found.sort((a, b) => b.at - a.at).map((entry) => entry.notice);
  };

  /** Sales of each citizen, from the market's activity, as public history lines. */
  const salesBySerial = (): Map<number, HistoryEntry[]> => {
    const map = new Map<number, HistoryEntry[]>();
    for (const sale of activity.sales) {
      const serial = serialOf(sale.asset);
      if (serial === undefined) continue;
      const entries = map.get(serial) ?? [];
      entries.push({ day: dayOf(sale.at), kind: 'sale', priceLamports: BigInt(sale.priceLamports) });
      map.set(serial, entries);
    }
    return map;
  };

  const build = (): DistrictSnapshot => {
    const minted = bySerial();
    const leaderboards = boards();
    const citizens: CitizenRecord[] = [];
    const credits: Record<number, StatCredits> = {};
    const owned: number[] = [];
    const history: Record<number, HistoryEntry[]> = {};
    const missionProgress: Record<string, MissionProgress> = {};
    const sales = salesBySerial();

    for (const [serial, onChain] of [...minted].sort((a, b) => a[0] - b[0])) {
      const base = roster.get(serial) as CitizenRecord;
      const { state } = onChain;
      citizens.push(
        state
          ? { ...base, intelligence: state.intelligence, alignment: state.alignment, compute: state.compute, registered: true }
          : { ...base, registered: false },
      );
      credits[serial] = state
        ? { intelligence: state.insightTrainingCredits, alignment: state.bondTrainingCredits, compute: state.craftTrainingCredits }
        : ZERO_CREDITS;

      // A sale is public, so every citizen shows its own; missions only for the wallet's citizens.
      const sold = sales.get(serial) ?? [];
      if (sold.length > 0) history[serial] = sold;
      if (!session || onChain.owner !== session.address) continue;
      owned.push(serial);
      const status = statuses.get(onChain.asset);
      const missions: HistoryEntry[] = [...(status?.claims ?? [])]
        .reverse()
        .map((claim) => ({ day: claim.day, kind: 'mission', missionId: claim.missionId, stat: claim.stat }));
      // Newest first; on the same day a sale goes before the missions of the new owner's wallet.
      history[serial] = [...sold, ...missions].sort((a, b) => b.day - a.day);
      const playing = status?.session;
      if (playing && !missionProgress[playing.missionId]) {
        // All steps done but the claim not landed: keep the last step open so it can be finished again.
        missionProgress[playing.missionId] = {
          citizenId: serial,
          done: Math.min(playing.done, playing.steps - 1),
          stat: playing.stat,
        };
      }
    }

    return {
      wallet: {
        connected: session !== null,
        label: session ? shorten(session.address) : '',
        tokenAtoms: balances.tokenAtoms,
        solLamports: balances.solLamports,
      },
      citizens,
      credits,
      mint: {
        priceLamports: BigInt(options.mintPriceLamports),
        // The Candy Machine knows the real supply and how many it handed out; the manifest value is the fallback.
        maxSupply: sale?.itemsAvailable ?? options.maxSupply,
        minted: sale?.itemsRedeemed ?? chain.length,
        limitPerWallet: options.mintLimitPerWallet,
        mintedByWallet: sale?.mintedByWallet ?? 0,
      },
      owned,
      // The founding list is a launch-day record that the chain does not keep.
      founding: [],
      history,
      missions: missionsNow(),
      missionProgress,
      season: {
        number: season?.id ?? 1,
        day: season ? Math.min(Math.max(season.day, 1), season.days) : 1,
        length: season?.days ?? 1,
        vaultLamports: 0n,
        fundedLamports: 0n,
        vaultAddress: '—',
        pools: POOL_RULES.map((rule) => ({ ...rule, validEntries: leaderboards[rule.id]?.length ?? 0 })),
        leaderboards,
      },
      market: marketNow(minted),
    };
  };

  /** Standings of this season, split by the bracket each citizen is in now. */
  const boards = (): Partial<Record<BracketId, LeaderboardEntry[]>> => {
    const byAsset = new Map(chain.map((citizen) => [citizen.asset, citizen]));
    const result: Partial<Record<BracketId, LeaderboardEntry[]>> = {};
    for (const standing of standings) {
      const onChain = byAsset.get(standing.asset);
      const base = onChain?.serial != null ? roster.get(onChain.serial) : undefined;
      if (!onChain || !base) continue;
      const state = onChain.state;
      const current = state ? { ...base, intelligence: state.intelligence, alignment: state.alignment, compute: state.compute } : base;
      const row: LeaderboardEntry = { citizenId: base.id, serial: base.code, roleKey: base.roleKey, points: standing.points };
      for (const bracket of ['open', bracketOf(current)] as const) (result[bracket] ??= []).push(row);
    }
    return result;
  };

  let state: DistrictSnapshot = build();

  const fail = (error: DistrictActionError) => ({ ok: false, error }) as const;
  const commit = (): DistrictActionResult => {
    state = build();
    return { ok: true, snapshot: state };
  };

  /** The asset of an owned citizen, or the reason there is none. */
  const ownedAsset = (citizenId: number): { asset: string; seller: string } | { error: DistrictActionError } => {
    if (!session) return { error: 'not-connected' };
    const onChain = bySerial().get(citizenId);
    if (!onChain || onChain.owner !== session.address) return { error: 'not-owner' };
    return { asset: onChain.asset, seller: session.address };
  };

  /** Chat with the citizens this wallet holds, through the chat server and the mission server's token. */
  const chat: CitizenChatPort | undefined = options.chatApi
    ? (() => {
        const chatApi = new ChatApi({
          baseUrl: options.chatApi.baseUrl,
          token: (force) => api.bearer(force),
          ...(options.chatApi.fetch ? { fetch: options.chatApi.fetch } : {}),
        });
        const assetOf = (citizenId: number): string => {
          const target = ownedAsset(citizenId);
          if ('error' in target) throw new ChatPortError(target.error === 'not-connected' ? 'not-connected' : 'not-owner');
          return target.asset;
        };
        /** Sign-in can fail on its own (the person closes the wallet prompt, the mission server is down). */
        const guard = async <T,>(work: () => Promise<T>): Promise<T> => {
          try {
            return await work();
          } catch (error) {
            if (error instanceof WalletDeclinedError) throw new ChatPortError('declined');
            if (error instanceof MissionApiError) throw new ChatPortError(error.code === 'not-connected' ? 'not-connected' : 'unavailable');
            throw error;
          }
        };
        return {
          status: (citizenId) => guard(() => chatApi.status(assetOf(citizenId))),
          send: (citizenId, message) => guard(() => chatApi.send(assetOf(citizenId), message)),
          memory: (citizenId) => guard(() => chatApi.memory(assetOf(citizenId))),
          forget: (citizenId) => guard(() => chatApi.forget(assetOf(citizenId))),
        };
      })()
    : undefined;

  /** Every read in one go. The server parts are optional: when it is down the last known season and missions stay. */
  async function load(): Promise<DistrictActionResult> {
    try {
      const [list, info, ranks, machine, listings, trades] = await Promise.all([
        reads.citizens(),
        api.season().catch(() => season),
        api.standings().catch(() => standings),
        // The sale is optional: without it the page falls back to the manifest numbers.
        reads.sale(session?.address ?? null).catch(() => sale),
        // A market that cannot be read keeps its last reading, like the sale.
        reads.market().catch(() => market),
        // Sales and bids come from the mission server, which reads them off the chain.
        api.marketActivity().catch(() => activity),
      ]);
      chain = list;
      season = info;
      standings = ranks;
      sale = machine;
      market = listings;
      activity = trades;
      balances = session ? await reads.balances(session.address) : { solLamports: 0n, tokenAtoms: 0n };
    } catch {
      return fail('unavailable');
    }

    statuses.clear();
    const mine = session ? chain.filter((citizen) => citizen.owner === session?.address) : [];
    if (session && mine.length > 0 && !signInDeclined) {
      try {
        if (!api.signedIn) await api.signIn();
        const results = await Promise.allSettled(mine.map((citizen) => api.status(citizen.asset)));
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') statuses.set((mine[index] as ChainCitizen).asset, result.value);
        });
      } catch (error) {
        // Closing the sign-in prompt is a choice; the next mission action asks again.
        if (error instanceof WalletDeclinedError) signInDeclined = true;
      }
    }
    return commit();
  }

  /** A server or wallet failure after which the cluster may still have changed. */
  async function failed(error: unknown): Promise<ReturnType<typeof fail>> {
    const code = actionErrorOf(error);
    if (code === 'transaction-failed') await load();
    // The mission server may have moved on before the failure (all steps done, claim not landed).
    else state = build();
    return fail(code);
  }

  async function claimAndConfirm(asset: string, missionId: string): Promise<void> {
    if (!session) throw new MissionApiError('not-connected');
    const outcome = await api.claim(asset, missionId);
    if (outcome.status === 'confirmed') return;
    const signed = await session.signTransaction(fromBase64(outcome.transaction));
    await transactions.send(signed);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await api.confirm(asset, missionId);
        return;
      } catch (error) {
        // The server reads the cluster itself and can be a moment behind the transaction that was just confirmed.
        const behind = error instanceof MissionApiError && error.code === 'claim-missing';
        if (!behind || attempt >= CONFIRM_ATTEMPTS) throw error;
        await sleep(CONFIRM_WAIT_MS);
      }
    }
  }

  /** Signs and sends one market transaction, then reads everything again. */
  async function sendMarket(build: () => Promise<Uint8Array>): Promise<DistrictActionResult> {
    if (!session) return fail('not-connected');
    try {
      await transactions.send(await session.signTransaction(await build()));
    } catch (error) {
      const refused = error instanceof TransactionFailedError && error.marketError ? MARKET_ERRORS[error.marketError] : undefined;
      if (!refused) return failed(error);
      await load();
      return fail(refused);
    }
    return load();
  }

  return {
    mode: 'chain',
    ...(chat ? { chat } : {}),

    snapshot: () => state,

    refresh: () => load(),

    async setWallet(next) {
      session = next;
      api.forget();
      signInDeclined = false;
      statuses.clear();
      balances = { solLamports: 0n, tokenAtoms: 0n };
      return load();
    },

    async mintCitizen() {
      if (!session) return fail('not-connected');
      const { mint, wallet } = state;
      // Same checks as the server and the Candy Guard, so a refusal costs no wallet prompt; the guard stays the judge.
      if (mint.minted >= mint.maxSupply) return fail('sold-out');
      if (mint.mintedByWallet >= mint.limitPerWallet) return fail('mint-limit');
      if (wallet.solLamports < mint.priceLamports) return fail('insufficient-sol');

      let minted: string;
      try {
        signInDeclined = false;
        const offer = await api.prepareMint();
        minted = offer.asset;
        await transactions.send(await session.signTransaction(fromBase64(offer.transaction)));
      } catch (error) {
        return failed(error);
      }

      // The mint and the registration were one transaction, so the citizen is there with its role and scores.
      for (let attempt = 1; ; attempt += 1) {
        const loaded = await load();
        if (!loaded.ok) return fail(loaded.error);
        const found = chain.find((citizen) => citizen.asset === minted);
        if (found?.serial != null && roster.has(found.serial)) {
          return { ok: true, snapshot: loaded.snapshot, citizenId: found.serial };
        }
        if (attempt >= MINT_VISIBLE_ATTEMPTS) return fail('unavailable');
        await sleep(CONFIRM_WAIT_MS);
      }
    },

    async upgradeScore(citizenId: number, stat: StatKey) {
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const citizen = state.citizens.find((item) => item.id === citizenId);
      const credits = state.credits[citizenId];
      if (!citizen || !credits || !session) return fail('not-owner');
      const score = citizen[stat];
      if (score >= MAX_STAT_SCORE) return fail('stat-at-max');
      if (credits[stat] < 1) return fail('no-credit');
      if (state.wallet.tokenAtoms < trainingCostAtoms(options.baseTrainingCostAtoms, score)) return fail('insufficient-balance');

      try {
        const unsigned = await transactions.buildUpgradeScore({ owner: session.address, asset: target.asset, stat });
        await transactions.send(await session.signTransaction(unsigned));
      } catch (error) {
        return failed(error);
      }
      return load();
    },

    async startMission(citizenId: number, missionId: string, stat: StatKey) {
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const citizen = state.citizens.find((item) => item.id === citizenId);
      const mission = state.missions.find((item) => item.id === missionId);
      if (!citizen) return fail('not-owner');
      if (!mission) return fail('mission-closed');
      // Same checks as the server, in the same order, so a refusal costs no round trip; the server stays the judge.
      const blocker = startBlocker(state, citizen, mission);
      if (blocker) return fail(blocker);
      if (!mission.rewards.includes(stat)) return fail('invalid-stat');

      try {
        signInDeclined = false;
        statuses.set(target.asset, await api.start(target.asset, missionId, stat));
      } catch (error) {
        return failed(error);
      }
      return commit();
    },

    async advanceMission(citizenId: number, missionId: string, proof: StepProof) {
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const mission = state.missions.find((item) => item.id === missionId);
      const progress = state.missionProgress[missionId];
      if (!mission || !progress) return fail('mission-closed');
      if (progress.citizenId !== citizenId) return fail('mission-busy');

      try {
        const playing = statuses.get(target.asset)?.session;
        const claimWaiting = playing?.missionId === missionId && playing.done >= playing.steps;
        if (!claimWaiting) {
          const step = mission.steps[progress.done];
          if (!step || step.kind !== proof.kind) return fail('mission-closed');
          const next = await api.step(target.asset, missionId, proof);
          statuses.set(target.asset, next);
          if (next.session && next.session.done < next.session.steps) return commit();
        }
        // Every step is done: the credit is claimed on chain, signed by the owner.
        await claimAndConfirm(target.asset, missionId);
      } catch (error) {
        // A claim that did not go through leaves the last step open, so it can be tried again.
        return failed(error);
      }
      return load();
    },

    async abandonMission(missionId: string) {
      const progress = state.missionProgress[missionId];
      if (!progress) return fail('mission-closed');
      const target = ownedAsset(progress.citizenId);
      if ('error' in target) return fail(target.error);
      try {
        statuses.set(target.asset, await api.abandon(target.asset));
      } catch (error) {
        return failed(error);
      }
      return commit();
    },

    async listCitizen(citizenId: number, priceLamports: bigint) {
      if (!market || market.config.isPaused) return fail('market-closed');
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const found = listingOf(citizenId);
      const citizen = bySerial().get(citizenId) as ChainCitizen;
      // A listing of this owner that the market can still act on; anything else left on the asset is closed first.
      if (found && current(found.listing, citizen)) return fail('already-listed');
      if (auctionOf(citizenId) || citizen.frozen) return fail('in-auction');
      if (priceProblem(priceLamports, state.market)) return fail('invalid-price');
      return sendMarket(() =>
        transactions.buildListCitizen({
          seller: target.seller,
          asset: target.asset,
          priceLamports,
          transferDelegate: citizen.transferDelegate,
          staleListingSeller: found ? found.listing.seller : null,
        }),
      );
    },

    async changeListingPrice(citizenId: number, priceLamports: bigint) {
      if (!market || market.config.isPaused) return fail('market-closed');
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const found = listingOf(citizenId);
      if (!found || !current(found.listing, found.citizen)) return fail('not-listed');
      if (priceProblem(priceLamports, state.market)) return fail('invalid-price');
      if (priceLamports === found.listing.priceLamports) return commit();
      return sendMarket(() => transactions.buildChangeListingPrice({ seller: target.seller, asset: target.asset, priceLamports }));
    },

    async cancelListing(citizenId: number) {
      // The program takes a cancel while the market is paused, so a seller can always step back.
      if (!market) return fail('market-closed');
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const found = listingOf(citizenId);
      if (!found || found.listing.seller !== target.seller) return fail('not-listed');
      return sendMarket(() =>
        transactions.buildCancelListing({ seller: target.seller, asset: target.asset, transferDelegate: found.citizen.transferDelegate }),
      );
    },

    async auctionCitizen(citizenId: number, startPriceLamports: bigint, durationHours: number) {
      if (!market || market.config.isPaused) return fail('market-closed');
      const target = ownedAsset(citizenId);
      if ('error' in target) return fail(target.error);
      const citizen = bySerial().get(citizenId) as ChainCitizen;
      const found = listingOf(citizenId);
      if (found && current(found.listing, citizen)) return fail('already-listed');
      if (auctionOf(citizenId) || citizen.frozen) return fail('in-auction');
      if (priceProblem(startPriceLamports, state.market) || !AUCTION_HOURS.includes(durationHours)) return fail('invalid-price');
      return sendMarket(() =>
        transactions.buildStartAuction({
          seller: target.seller,
          asset: target.asset,
          startPriceLamports,
          durationHours,
          transferDelegate: citizen.transferDelegate,
          freezeDelegate: citizen.freezeDelegate,
          staleListingSeller: found ? found.listing.seller : null,
        }),
      );
    },

    async placeBid(citizenId: number, amountLamports: bigint) {
      if (!market || market.config.isPaused) return fail('market-closed');
      if (!session) return fail('not-connected');
      const found = auctionOf(citizenId);
      if (!found) return fail('listing-gone');
      const { auction, citizen } = found;
      if (Math.floor(clock() / 1000) >= auction.endsAt) return fail('auction-ended');
      if (!deliverable(auction, citizen)) return fail('listing-gone');
      if (auction.seller === session.address) return fail('own-listing');
      if (auction.bidCount > 0 && auction.highestBidder === session.address) return fail('already-highest');
      if (amountLamports < minNextBid(auction.startPriceLamports, auction.bidCount > 0 ? auction.highestBidLamports : null)) return fail('bid-too-low');
      if (amountLamports > MAX_PRICE_LAMPORTS) return fail('invalid-price');
      if (state.wallet.solLamports < amountLamports) return fail('insufficient-sol');
      const bidder = session.address;
      return sendMarket(() =>
        transactions.buildPlaceBid({ bidder, asset: auction.asset, amountLamports, previousBidder: auction.bidCount > 0 ? auction.highestBidder : null }),
      );
    },

    async cancelAuction(citizenId: number) {
      // Allowed while the market is paused, as in the program.
      if (!market) return fail('market-closed');
      if (!session) return fail('not-connected');
      const found = auctionOf(citizenId);
      if (!found || found.auction.seller !== session.address) return fail('not-listed');
      if (found.auction.bidCount > 0) return fail('auction-has-bids');
      const seller = session.address;
      return sendMarket(() =>
        transactions.buildCancelAuction({
          seller,
          asset: found.auction.asset,
          transferDelegate: found.citizen.transferDelegate,
          freezeDelegate: found.citizen.freezeDelegate,
        }),
      );
    },

    async settleAuction(citizenId: number) {
      if (!market) return fail('market-closed');
      if (!session) return fail('not-connected');
      const found = auctionOf(citizenId);
      if (!found) return fail('listing-gone');
      const { auction, citizen } = found;
      const ended = Math.floor(clock() / 1000) >= auction.endsAt;
      // Before the end only an auction that cannot deliver may be finished, to pay its bid back.
      if (!ended && !(auction.bidCount > 0 && !deliverable(auction, citizen))) return fail('auction-live');
      const caller = session.address;
      const { config } = market;
      return sendMarket(() => transactions.buildSettleAuction({ caller, auction, config }));
    },

    async buyCitizen(citizenId: number) {
      if (!market || market.config.isPaused) return fail('market-closed');
      if (!session) return fail('not-connected');
      const shown = state.market.listings.find((item) => item.citizenId === citizenId);
      const found = listingOf(citizenId);
      if (!shown || !found || !current(found.listing, found.citizen) || found.citizen.frozen) return fail('listing-gone');
      if (found.citizen.owner === session.address) return fail('own-listing');
      if (state.wallet.solLamports < shown.priceLamports) return fail('insufficient-sol');
      const buyer = session.address;
      const { config } = market;
      // The price on screen is the most the buyer pays; a seller who raised it since makes the program refuse.
      return sendMarket(() =>
        transactions.buildBuyCitizen({
          buyer,
          asset: found.citizen.asset,
          seller: found.listing.seller,
          maxPriceLamports: shown.priceLamports,
          config,
        }),
      );
    },
  };
}
