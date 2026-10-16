import type { CitizenRecord, StatKey } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { MISSION_CATALOG } from '../missionCatalog';
import { AUCTION_CLOCKS, AUCTION_HOURS, MAX_PRICE_LAMPORTS, MIN_PRICE_LAMPORTS, OFFER_DAYS, ROYALTY_BPS, minNextBid } from '../market';
import type {
  DistrictSnapshot,
  HistoryEntry,
  LeaderboardEntry,
  MarketAuction,
  MarketListing,
  MarketOffer,
  MarketSale,
  MissionDefinition,
  StatCredits,
} from '../types';

/**
 * The mock district: one wallet that owns three citizens on day 12 of
 * season 1, all of which have played for a while. Pip has not been minted
 * yet; minting is how the start of the route (Tier 0) is tried. Every number
 * follows the program rules, so the history of an owned citizen adds up to
 * its scores and burned tokens.
 */

type Scores = Readonly<Record<StatKey, number>>;

const SCORES: Readonly<Record<number, Scores>> = {
  1: { intelligence: 1, alignment: 2, compute: 4 },
  2: { intelligence: 6, alignment: 1, compute: 1 },
  3: { intelligence: 2, alignment: 4, compute: 1 },
  4: { intelligence: 0, alignment: 3, compute: 1 },
  8: { intelligence: 2, alignment: 1, compute: 5 },
  11: { intelligence: 0, alignment: 2, compute: 6 },
  13: { intelligence: 1, alignment: 3, compute: 5 },
  18: { intelligence: 6, alignment: 1, compute: 3 },
  19: { intelligence: 1, alignment: 5, compute: 0 },
};

const OWNED = [1, 2, 4] as const;

/** Roster citizens nobody has minted yet; a mint draws from these. */
export const MOCK_UNMINTED: readonly number[] = [12];

/** Mock wallet balance in lamports, enough for a few mints. */
const MOCK_SOL_LAMPORTS = 2_500_000_000n;
const FOUNDING = [1, 2, 3, 4, 8] as const;

/**
 * What other players have put up for sale in the preview. They are citizens of the
 * roster the wallet does not own, so each one can be opened, bought and kept.
 */
const MOCK_LISTINGS: readonly MarketListing[] = [
  { citizenId: 19, seller: '3mRt…Wq2', priceLamports: 650_000_000n, listedDay: 10 },
  { citizenId: 3, seller: '9bKd…4Lp', priceLamports: 450_000_000n, listedDay: 11 },
  { citizenId: 8, seller: '3mRt…Wq2', priceLamports: 1_200_000_000n, listedDay: 9 },
  { citizenId: 11, seller: 'H2vN…x5T', priceLamports: 2_400_000_000n, listedDay: 12 },
];

/**
 * Sales other players finished before the preview starts: Ivy won at auction
 * and Milo bought at a fixed price, each by the wallet that lists it again now.
 */
/** The mock wallet's address as the header shows it. */
const MOCK_WALLET_LABEL = '7xQ4…9fA';

/**
 * Offers the preview starts with: three on Farmer Hale, one the wallet owns
 * (one of them past its end, so the screens show that state too), and the
 * wallet's own offer on Milo, who is also listed for a fixed price.
 */
function mockOffers(nowSeconds: number): MarketOffer[] {
  const hours = (count: number) => Math.round(count * 3_600);
  const offer = (id: string, citizenId: number, buyer: string, amountLamports: bigint, madeHoursAgo: number, days: number): MarketOffer => ({
    id,
    citizenId,
    buyer,
    amountLamports,
    madeAt: nowSeconds - hours(madeHoursAgo),
    expiresAt: nowSeconds - hours(madeHoursAgo) + days * hours(24),
    mine: buyer === MOCK_WALLET_LABEL,
  });
  return [
    offer('mock-offer-1', 1, 'Bn7w…T2s', 300_000_000n, 5, 3),
    offer('mock-offer-2', 1, 'Kx3p…9Qe', 250_000_000n, 26, 7),
    offer('mock-offer-3', 1, 'Hd4r…L8m', 400_000_000n, 30, 1),
    offer('mock-offer-4', 3, MOCK_WALLET_LABEL, 350_000_000n, 3, 3),
  ];
}

function mockSales(nowSeconds: number): MarketSale[] {
  const hoursAgo = (hours: number) => nowSeconds - Math.round(hours * 3_600);
  const bid = (bidder: string, amountLamports: bigint, hours: number) => ({ bidder, amountLamports, at: hoursAgo(hours), mine: false });
  return [
    {
      id: 'mock-sale-auction-19',
      citizenId: 19,
      kind: 'auction',
      priceLamports: 550_000_000n,
      seller: 'Q6aY…r1D',
      buyer: '3mRt…Wq2',
      sellerIsMe: false,
      buyerIsMe: false,
      at: hoursAgo(5),
      bids: [bid('3mRt…Wq2', 550_000_000n, 5.2), bid('Hd4r…L8m', 500_000_000n, 9), bid('3mRt…Wq2', 420_000_000n, 20)],
    },
    {
      id: 'mock-sale-fixed-3',
      citizenId: 3,
      kind: 'fixed',
      priceLamports: 380_000_000n,
      seller: 'H2vN…x5T',
      buyer: '9bKd…4Lp',
      sellerIsMe: false,
      buyerIsMe: false,
      at: hoursAgo(30),
      bids: [],
    },
  ];
}

/**
 * Auctions other players run in the preview, timed from when the preview
 * starts: one with bids that ends in a few hours, one nobody has bid on yet.
 */
function mockAuctions(nowSeconds: number): MarketAuction[] {
  /** `bids` oldest first, as `[bidder, lamports, minutes ago]`. */
  const auction = (
    citizenId: number,
    seller: string,
    start: bigint,
    bids: readonly (readonly [string, bigint, number])[],
    hours: number,
  ): MarketAuction => {
    const newestFirst = [...bids].reverse().map(([bidder, amountLamports, minutesAgo]) => ({
      bidder,
      amountLamports,
      at: nowSeconds - minutesAgo * 60,
      mine: false,
    }));
    const highest = newestFirst[0]?.amountLamports ?? null;
    return {
      citizenId,
      seller,
      startPriceLamports: start,
      highestBidLamports: highest,
      bidCount: newestFirst.length,
      bids: newestFirst,
      endsAt: nowSeconds + Math.round(hours * 3_600),
      minBidLamports: minNextBid(start, highest),
      leading: false,
      sellerIsMe: false,
      deliverable: true,
    };
  };
  return [
    auction(
      13,
      'Fz8e…M7c',
      500_000_000n,
      [
        ['Kx3p…9Qe', 500_000_000n, 1_220],
        ['Bn7w…T2s', 530_000_000n, 1_105],
        ['Kx3p…9Qe', 560_000_000n, 760],
        ['Hd4r…L8m', 620_000_000n, 312],
        ['Bn7w…T2s', 700_000_000n, 95],
        ['Hd4r…L8m', 820_000_000n, 14],
      ],
      3.2,
    ),
    auction(18, 'Q6aY…r1D', 1_500_000_000n, [], 41),
  ];
}

const CREDITS: Readonly<Record<number, StatCredits>> = {
  1: { intelligence: 0, alignment: 1, compute: 2 },
  2: { intelligence: 1, alignment: 0, compute: 0 },
  4: { intelligence: 0, alignment: 1, compute: 1 },
};

const NO_CREDITS: StatCredits = { intelligence: 0, alignment: 0, compute: 0 };

/**
 * Right reply of every talk step, by mission and step index. The mock source
 * checks proofs against this table; the screens never see it, as with the
 * mission server's catalog.
 */
export const MOCK_ANSWERS: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  lightsOut: { 1: 1, 2: 2 },
  hearthDeliveries: { 2: 0 },
  nightPatrol: { 3: 2 },
  blackoutNight: { 1: 1, 2: 0 },
  summitTrial: { 2: 1 },
};

/** Hours until the mock season's event opens, by mission id. */
const MOCK_EVENT_OPENS_IN_HOURS: Readonly<Record<string, number>> = { blackoutNight: 52 };

export const MOCK_MISSIONS: readonly MissionDefinition[] = MISSION_CATALOG.map((mission) => {
  const opensInHours = MOCK_EVENT_OPENS_IN_HOURS[mission.id];
  return opensInHours === undefined ? mission : { ...mission, opensInHours };
});

/** Training steps an owned citizen took, oldest first, as `[day, stat]`. */
const TRAINING: Readonly<Record<number, readonly (readonly [number, StatKey])[]>> = {
  1: [
    [3, 'intelligence'],
    [5, 'alignment'],
    [7, 'compute'],
    [11, 'compute'],
  ],
  2: [
    [2, 'compute'],
    [4, 'intelligence'],
    [6, 'intelligence'],
    [8, 'intelligence'],
    [10, 'intelligence'],
  ],
  4: [[6, 'alignment']],
};

/**
 * Missions finished, as `[day, missionId, stat]`. Each training step above
 * spends a credit earned here on an earlier day, and what is left over is
 * exactly `CREDITS`.
 */
const MISSIONS_DONE: Readonly<Record<number, readonly (readonly [number, string, StatKey])[]>> = {
  1: [
    [1, 'lightsOut', 'intelligence'],
    [2, 'hearthDeliveries', 'alignment'],
    [4, 'streetLamp', 'compute'],
    [6, 'streetLamp', 'compute'],
    [8, 'hearthDeliveries', 'alignment'],
    [9, 'streetLamp', 'compute'],
    [10, 'streetLamp', 'compute'],
  ],
  2: [
    [1, 'streetLamp', 'compute'],
    [3, 'lightsOut', 'intelligence'],
    [5, 'lightsOut', 'intelligence'],
    [7, 'lightsOut', 'intelligence'],
    [9, 'lightsOut', 'intelligence'],
    [11, 'lightsOut', 'intelligence'],
  ],
  4: [
    [3, 'hearthDeliveries', 'alignment'],
    [5, 'streetLamp', 'compute'],
    [8, 'nightPatrol', 'alignment'],
  ],
};

function historyOf(citizen: CitizenRecord, start: Scores, baseTrainingCostAtoms: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [{ day: 1, kind: 'register' }];
  const current: Record<StatKey, number> = { ...start };
  for (const [day, stat] of TRAINING[citizen.id] ?? []) {
    entries.push({
      day,
      kind: 'train',
      stat,
      from: current[stat],
      burnedAtoms: trainingCostAtoms(baseTrainingCostAtoms, current[stat]),
    });
    current[stat] += 1;
  }
  for (const [day, missionId, stat] of MISSIONS_DONE[citizen.id] ?? []) {
    entries.push({ day, kind: 'mission', missionId, stat });
  }
  return entries.sort((a, b) => b.day - a.day);
}

function leaderboard(): readonly LeaderboardEntry[] {
  const rows: readonly (readonly [number | null, string, CitizenRecord['roleKey'], number])[] = [
    [18, '#018', 'navigator', 1420],
    [11, '#011', 'artisan', 1310],
    [13, '#013', 'artisan', 1190],
    [19, '#019', 'steward', 1040],
    [1, '#001', 'artisan', 985],
    [null, '#027', 'pioneer', 930],
    [8, '#008', 'mentor', 870],
    [3, '#003', 'steward', 845],
    [null, '#031', 'scholar', 790],
  ];
  return rows.map(([citizenId, serial, roleKey, points]) => ({ citizenId, serial, roleKey, points }));
}

export interface MockSnapshotOptions {
  /** Lamports one mint costs, from the cluster manifest. */
  mintPriceLamports: bigint;
  /** Citizens one wallet can mint, from the cluster manifest. */
  mintLimitPerWallet: number;
  /** `empty` starts a wallet that owns no citizen yet, to try the first mint. */
  start?: 'owned' | 'empty';
  /** Unix seconds the sample auctions are timed from. */
  nowSeconds: number;
}

export function createMockSnapshot(
  roster: readonly CitizenRecord[],
  baseTrainingCostAtoms: string,
  options: MockSnapshotOptions,
): DistrictSnapshot {
  // Only minted citizens are part of the district; a mint adds the others.
  const citizens = roster
    .filter((citizen) => !MOCK_UNMINTED.includes(citizen.id))
    .map((citizen) => {
      const scores = SCORES[citizen.id];
      return scores ? { ...citizen, ...scores, registered: true } : { ...citizen, registered: true };
    });
  const owned = options.start === 'empty' ? [] : OWNED.filter((id) => citizens.some((citizen) => citizen.id === id));

  const history: Record<number, HistoryEntry[]> = {};
  for (const id of owned) {
    const base = roster.find((citizen) => citizen.id === id);
    if (base) history[id] = historyOf(base, base, baseTrainingCostAtoms);
  }

  const credits: Record<number, StatCredits> = {};
  for (const citizen of citizens) credits[citizen.id] = CREDITS[citizen.id] ?? NO_CREDITS;

  return {
    wallet: { connected: true, label: MOCK_WALLET_LABEL, tokenAtoms: 1_240_000_000n, solLamports: MOCK_SOL_LAMPORTS },
    // The preview roster is the whole collection, so the mint ends when it is out.
    mint: {
      priceLamports: options.mintPriceLamports,
      maxSupply: roster.length,
      minted: citizens.length,
      limitPerWallet: options.mintLimitPerWallet,
      // Citizens the wallet already holds came from the market, not from this sale.
      mintedByWallet: 0,
    },
    citizens,
    credits,
    owned,
    founding: [...FOUNDING],
    history,
    missions: MOCK_MISSIONS,
    missionProgress: { streetLamp: { citizenId: 1, done: 1, stat: 'compute' } },
    season: {
      number: 1,
      day: 12,
      length: 28,
      vaultLamports: 18_420_000_000n,
      fundedLamports: 6_000_000_000n,
      vaultAddress: 'PZv4…k2Q8',
      pools: [
        { id: 'open', shareBps: 3000, maxWinners: 10, validEntries: 64 },
        { id: 'rookie', shareBps: 1000, maxWinners: 10, validEntries: 51 },
        { id: 'skilled', shareBps: 1500, maxWinners: 7, validEntries: 38 },
        { id: 'elite', shareBps: 2000, maxWinners: 5, validEntries: 12 },
        { id: 'master', shareBps: 2500, maxWinners: 3, validEntries: 0 },
      ],
      leaderboards: { skilled: leaderboard() },
      // The preview has no vault account; the prize stage and claims come from devnet.
      prize: null,
    },
    market: {
      open: true,
      royaltyBps: ROYALTY_BPS,
      minPriceLamports: MIN_PRICE_LAMPORTS,
      maxPriceLamports: MAX_PRICE_LAMPORTS,
      listings: MOCK_LISTINGS.filter(
        (listing) => citizens.some((citizen) => citizen.id === listing.citizenId) && !(owned as readonly number[]).includes(listing.citizenId),
      ),
      auctions: mockAuctions(options.nowSeconds).filter(
        (auction) => citizens.some((citizen) => citizen.id === auction.citizenId) && !(owned as readonly number[]).includes(auction.citizenId),
      ),
      sales: mockSales(options.nowSeconds).filter((sale) => citizens.some((citizen) => citizen.id === sale.citizenId)),
      auctionHours: AUCTION_HOURS,
      auctionClock: AUCTION_CLOCKS.real,
      notices: [],
      offersOpen: true,
      // An offer stays only on a minted citizen; offers to the wallet only on one it owns, its own only on one it does not.
      offers: mockOffers(options.nowSeconds).filter(
        (offer) =>
          citizens.some((citizen) => citizen.id === offer.citizenId) &&
          (owned as readonly number[]).includes(offer.citizenId) !== offer.mine,
      ),
      offerDays: OFFER_DAYS,
      offerDepositLamports: 0n,
    },
  };
}
