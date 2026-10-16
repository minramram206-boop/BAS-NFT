import {
  AUCTION_CLOCKS,
  AUCTION_DURATIONS_HOURS,
  MARKET_MAX_PRICE_LAMPORTS,
  MARKET_MIN_PRICE_LAMPORTS,
  type AuctionClock,
} from '@bas/chain-client/browser';
import type { CitizenRecord, RoleKey } from '@bas/content';
import { highestStat } from './districts';
import type { MarketAuction, MarketBid, MarketListing, MarketNotice, MarketSale, MarketSnapshot } from './types';

/**
 * The market as the screens use it (D-0082, D-0087, docs/MARKET.md). The
 * program's own rules (price limits, auction lengths, the next bid) come from
 * `@bas/chain-client`, which tests them against `programs/market`, so a price
 * or bid the form accepts is one the program accepts.
 */

export { AUCTION_CLOCKS, auctionClockOf, formatSolExact, minNextBid } from '@bas/chain-client/browser';

const LAMPORTS_PER_SOL = 1_000_000_000n;
const BPS_DENOMINATOR = 10_000n;

/** Lowest asking price: 0.01 SOL. Below this a sale is mostly network fees. */
export const MIN_PRICE_LAMPORTS = MARKET_MIN_PRICE_LAMPORTS;
/** Highest asking price: 1,000 SOL, far above anything a citizen is worth and low enough to catch a slipped decimal. */
export const MAX_PRICE_LAMPORTS = MARKET_MAX_PRICE_LAMPORTS;
/** The collection's Royalties plugin (SPEC §6.2). */
export const ROYALTY_BPS = 500;

/**
 * Reads a price typed in SOL into lamports without going through floating point.
 * Accepts `1`, `0.65`, `.5` and, when there is no dot, a comma as the decimal mark
 * (`0,65`). Anything else, including more than nine decimals, gives `null`.
 */
export function parseSolInput(text: string): bigint | null {
  const match = /^(\d*)(?:[.,](\d{1,9}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return null;
  return BigInt(whole === '' ? '0' : whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0'));
}

/** How long an auction may run, in hours. */
export const AUCTION_HOURS: readonly number[] = AUCTION_DURATIONS_HOURS;

/** A bid to suggest: the lowest one the auction takes, rounded up to a thousandth of a SOL. */
export function suggestedBid(minBidLamports: bigint): bigint {
  const step = 1_000_000n;
  return ((minBidLamports + step - 1n) / step) * step;
}

/** When an auction ends after a bid at `now`: the late-bid window after a late bid, else unchanged. */
export function endAfterBid(endsAt: number, now: number, clock: AuctionClock = AUCTION_CLOCKS.real): number {
  return Math.max(endsAt, now + clock.extensionSeconds);
}

/**
 * A length of time in words, at its largest whole unit: `24 hours`, `4 minutes`,
 * `1 minute`, `90 seconds`. Used for auction lengths and the late-bid window,
 * which are whole hours on the real clock and whole minutes on the devnet one.
 */
export function clockSpan(seconds: number): string {
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`;
  if (seconds >= 3_600 && seconds % 3_600 === 0) return unit(seconds / 3_600, 'hour');
  if (seconds >= 60 && seconds % 60 === 0) return unit(seconds / 60, 'minute');
  return unit(seconds, 'second');
}

/** `2h 05m left`, `4m 10s left`; the caller says when it has ended. Seconds while under ten minutes. */
export function timeLeftText(seconds: number): string {
  const left = Math.max(0, Math.floor(seconds));
  const days = Math.floor(left / 86_400);
  const hours = Math.floor((left % 86_400) / 3_600);
  const minutes = Math.floor((left % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (left >= 600) return `${minutes}m`;
  return `${minutes}m ${String(left % 60).padStart(2, '0')}s`;
}

/** `just now`, `12m ago`, `3h ago`, `2d ago`. A bid without a time yet is `just now`. */
export function timeAgoText(at: number | null, now: number): string {
  const ago = at === null ? 0 : Math.max(0, now - at);
  if (ago < 60) return 'just now';
  if (ago < 3_600) return `${Math.floor(ago / 60)}m ago`;
  if (ago < 86_400) return `${Math.floor(ago / 3_600)}h ago`;
  return `${Math.floor(ago / 86_400)}d ago`;
}

/** A bid in the feed of every auction: which citizen it was for and whether it still leads. */
export interface FeedBid {
  readonly citizenId: number;
  readonly bid: MarketBid;
  /** The highest bid of its auction. */
  readonly leading: boolean;
}

/**
 * The bids of the given auctions in one list, newest first. A bid the server
 * has not timed yet is the newest of all. At most `limit`.
 */
export function bidFeed(auctions: readonly MarketAuction[], limit: number): readonly FeedBid[] {
  const feed = auctions.flatMap((auction) => auction.bids.map((bid, index) => ({ citizenId: auction.citizenId, bid, leading: index === 0 })));
  const order = (entry: FeedBid) => entry.bid.at ?? Number.POSITIVE_INFINITY;
  return feed.sort((a, b) => (order(a) === order(b) ? 0 : order(a) > order(b) ? -1 : 1)).slice(0, limit);
}

/** The market of a cluster where the program is not deployed: no listings, and every action is refused. */
export const CLOSED_MARKET: MarketSnapshot = {
  open: false,
  royaltyBps: ROYALTY_BPS,
  minPriceLamports: MIN_PRICE_LAMPORTS,
  maxPriceLamports: MAX_PRICE_LAMPORTS,
  listings: [],
  auctions: [],
  sales: [],
  auctionHours: AUCTION_HOURS,
  auctionClock: AUCTION_CLOCKS.real,
  notices: [],
};

/** A price as it is typed in the form: `650000000` is `0.65`, `1000000000` is `1`. */
export function solInputText(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

export type PriceProblem = 'too-low' | 'too-high';

export function priceProblem(
  priceLamports: bigint,
  rules: Pick<MarketSnapshot, 'minPriceLamports' | 'maxPriceLamports'>,
): PriceProblem | null {
  if (priceLamports < rules.minPriceLamports) return 'too-low';
  if (priceLamports > rules.maxPriceLamports) return 'too-high';
  return null;
}

export interface SaleSplit {
  /** Paid to the creators of the collection. */
  readonly royaltyLamports: bigint;
  /** What the seller keeps. */
  readonly proceedsLamports: bigint;
}

/** How a sale divides: the royalty is rounded down and the seller keeps the rest, so nothing is lost. */
export function splitSale(priceLamports: bigint, royaltyBps: number): SaleSplit {
  const royaltyLamports = (priceLamports * BigInt(royaltyBps)) / BPS_DENOMINATOR;
  return { royaltyLamports, proceedsLamports: priceLamports - royaltyLamports };
}

export type MarketSort = 'newest' | 'priceLow' | 'priceHigh' | 'strongest';
export const MARKET_SORTS: readonly MarketSort[] = ['newest', 'priceLow', 'priceHigh', 'strongest'];

export type RoleFilter = RoleKey | 'all';

/** The listings that match the role filter, in the order of `sort`. Ties keep the order they came in. */
export function shownListings(
  listings: readonly MarketListing[],
  citizens: readonly CitizenRecord[],
  filter: { role: RoleFilter; sort: MarketSort },
): readonly MarketListing[] {
  const byId = new Map(citizens.map((citizen) => [citizen.id, citizen]));
  const matching = listings.filter((listing) => {
    const citizen = byId.get(listing.citizenId);
    return citizen !== undefined && (filter.role === 'all' || citizen.roleKey === filter.role);
  });
  const compare = (a: MarketListing, b: MarketListing): number => {
    switch (filter.sort) {
      case 'priceLow':
        return a.priceLamports < b.priceLamports ? -1 : a.priceLamports > b.priceLamports ? 1 : 0;
      case 'priceHigh':
        return a.priceLamports > b.priceLamports ? -1 : a.priceLamports < b.priceLamports ? 1 : 0;
      case 'strongest': {
        const left = byId.get(a.citizenId);
        const right = byId.get(b.citizenId);
        return (right ? highestStat(right) : 0) - (left ? highestStat(left) : 0);
      }
      case 'newest':
        return b.listedDay - a.listedDay;
    }
  };
  return [...matching].sort(compare);
}

/** The auctions that match the role filter, the one ending first at the top. */
export function shownAuctions(
  auctions: readonly MarketAuction[],
  citizens: readonly CitizenRecord[],
  role: RoleFilter,
): readonly MarketAuction[] {
  const byId = new Map(citizens.map((citizen) => [citizen.id, citizen]));
  return auctions
    .filter((auction) => {
      const citizen = byId.get(auction.citizenId);
      return citizen !== undefined && (role === 'all' || citizen.roleKey === role);
    })
    .sort((a, b) => a.endsAt - b.endsAt);
}

/** The finished sales of citizens that match the role filter, newest first as they came. */
export function shownSales(
  sales: readonly MarketSale[],
  citizens: readonly CitizenRecord[],
  role: RoleFilter,
): readonly MarketSale[] {
  const byId = new Map(citizens.map((citizen) => [citizen.id, citizen]));
  return sales.filter((sale) => {
    const citizen = byId.get(sale.citizenId);
    return citizen !== undefined && (role === 'all' || citizen.roleKey === role);
  });
}

/** Notice ids one browser remembers per wallet; the oldest are forgotten first. */
export const SEEN_NOTICES_LIMIT = 200;

/**
 * What the connected wallet can do with an auction. The auction stops taking
 * bids on its own at `endsAt`; only handing the citizen over needs a
 * transaction (`settle_auction`), and the program lets anyone send it. The
 * screens offer it to the side that gains from it:
 *
 * - `live`: still taking bids;
 * - `claim`: the wallet won and claims the citizen; the seller is paid in the same step;
 * - `collect`: the wallet sold it and collects the payment; the citizen goes to the winner in the same step;
 * - `take-back`: nobody bid and the wallet, the seller, frees its citizen;
 * - `refund`: the seller stopped the auction and the wallet takes its highest bid back;
 * - `close`: the wallet stopped its own auction and ends it, paying the highest bid back;
 * - `waiting`: over, and up to the winner or the seller.
 */
export type AuctionStage = 'live' | 'claim' | 'collect' | 'take-back' | 'refund' | 'close' | 'waiting';

export function auctionStage(auction: MarketAuction, mine: boolean, now: number | null): AuctionStage {
  const stopped = !auction.deliverable && auction.bidCount > 0;
  const ended = now !== null && now >= auction.endsAt;
  if (stopped) return auction.leading ? 'refund' : mine ? 'close' : 'waiting';
  if (!ended) return 'live';
  if (auction.bidCount === 0) return mine ? 'take-back' : 'waiting';
  return auction.leading ? 'claim' : mine ? 'collect' : 'waiting';
}

/**
 * Notices for ended auctions that wait on the wallet: one it won and one it
 * sold. The id holds the end time, which no longer moves once the auction is over.
 */
export function auctionNotices(
  auctions: readonly MarketAuction[],
  owned: readonly number[],
  now: number | null,
): MarketNotice[] {
  const notices: MarketNotice[] = [];
  for (const auction of auctions) {
    const price = auction.highestBidLamports;
    if (price === null) continue;
    const stage = auctionStage(auction, owned.includes(auction.citizenId), now);
    if (stage === 'claim' || stage === 'collect') {
      notices.push({ id: `${stage}-${auction.citizenId}-${auction.endsAt}`, kind: stage, citizenId: auction.citizenId, priceLamports: price });
    }
  }
  return notices;
}

/** The notices not shown yet, newest first as they came. */
export function unseenNotices(notices: readonly MarketNotice[], seen: readonly string[]): readonly MarketNotice[] {
  const known = new Set(seen);
  return notices.filter((notice) => !known.has(notice.id));
}

/** `seen` with every id of `notices` added, newest first, at most `SEEN_NOTICES_LIMIT`. */
export function markNoticesSeen(seen: readonly string[], notices: readonly MarketNotice[]): string[] {
  const fresh = unseenNotices(notices, seen).map((notice) => notice.id);
  return [...fresh, ...seen].slice(0, SEEN_NOTICES_LIMIT);
}
