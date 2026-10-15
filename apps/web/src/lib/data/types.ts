import type { AuctionClock } from '@bas/chain-client/browser';
import type { CitizenRecord, StatKey } from '@bas/content';
import type { CitizenChatPort } from './chat';

/**
 * View model of the district, shared by every data source (D-0020).
 *
 * Scores and credits mirror `CitizenState` in `programs/district`, so a screen
 * built on the mock source keeps working when the chain source replaces it.
 * Copy is never stored here: entries carry ids and numbers, and the screens
 * render them through `src/messages/en.json`.
 */

export type DistrictId = 'plaza' | 'archive' | 'hearth' | 'forge' | 'watch' | 'frontier' | 'summit';

export type StatCredits = Readonly<Record<StatKey, number>>;

export type HistoryEntry =
  | { readonly day: number; readonly kind: 'register' }
  | {
      readonly day: number;
      readonly kind: 'train';
      readonly stat: StatKey;
      readonly from: number;
      readonly burnedAtoms: bigint;
    }
  | {
      readonly day: number;
      readonly kind: 'mission';
      readonly missionId: string;
      readonly stat: StatKey;
    }
  /** The citizen changed hands in the market; public like the rest of its history. */
  | { readonly day: number; readonly kind: 'sale'; readonly priceLamports: bigint };

/**
 * One step of a mission (D-0025). The copy for each step lives at the same
 * index in `messages.missions.catalog.<id>.steps`.
 */
export type MissionStep =
  /** Walk the citizen to this cell `[gx, gy]` on the map. */
  | { readonly kind: 'goto'; readonly cell: readonly [number, number] }
  /** Pick one of three replies. The right one is known only to the data source. */
  | { readonly kind: 'talk' }
  /** Put the step's pieces back in the order they are listed in the copy. */
  | { readonly kind: 'puzzle' };

/** What the player did for the current step; the data source decides whether it was right. */
export type StepProof =
  | { readonly kind: 'goto' }
  | { readonly kind: 'talk'; readonly answer: number }
  /** Piece indexes in the order the player placed them; the right order is `0, 1, 2, ...`. */
  | { readonly kind: 'puzzle'; readonly order: readonly number[] };

export interface MissionDefinition {
  /** Key of the mission copy in `messages.missions.catalog`. */
  readonly id: string;
  readonly district: DistrictId;
  /** Stats the credit can be for; with more than one the player picks at start. */
  readonly rewards: readonly StatKey[];
  readonly steps: readonly MissionStep[];
  /** A district event: it can only be started inside its scheduled window. */
  readonly event?: true;
  /** An event that opens later; it cannot be started yet. Absent once the window is open. */
  readonly opensInHours?: number;
}

export interface MissionProgress {
  readonly citizenId: number;
  /** Steps finished so far, `0` right after starting. */
  readonly done: number;
  /** The stat the credit will be for, fixed when the mission starts. */
  readonly stat: StatKey;
}

export type BracketId = 'open' | 'rookie' | 'skilled' | 'elite' | 'master';

export interface LeaderboardEntry {
  /** A citizen from the roster, or `null` for one outside this preview. */
  readonly citizenId: number | null;
  /** Public serial, used when the citizen is not in the roster. */
  readonly serial: string;
  readonly roleKey: CitizenRecord['roleKey'];
  readonly points: number;
}

export interface BracketPool {
  readonly id: BracketId;
  /** Share of the season pool in basis points. */
  readonly shareBps: number;
  readonly maxWinners: number;
  readonly validEntries: number;
}

export interface SeasonSnapshot {
  readonly number: number;
  readonly day: number;
  readonly length: number;
  /** Lamports in the prize vault PDA. */
  readonly vaultLamports: bigint;
  /** Lamports set aside for this season by `fund_season`. */
  readonly fundedLamports: bigint;
  readonly vaultAddress: string;
  readonly pools: readonly BracketPool[];
  readonly leaderboards: Readonly<Partial<Record<BracketId, readonly LeaderboardEntry[]>>>;
}

export interface WalletView {
  /** False until a wallet is connected; the balances are then zero. */
  readonly connected: boolean;
  /** Shortened address shown in the header. */
  readonly label: string;
  /** Utility token balance in atoms. */
  readonly tokenAtoms: bigint;
  /** SOL balance in lamports, spent on minting. */
  readonly solLamports: bigint;
}

/** The citizen mint: what one costs and how many are left (SPEC §6). */
export interface MintStatus {
  /** Lamports one mint costs, from the cluster manifest. */
  readonly priceLamports: bigint;
  readonly maxSupply: number;
  readonly minted: number;
  /** Citizens one wallet can mint in the public sale (Candy Guard `mintLimit`). */
  readonly limitPerWallet: number;
  /** Citizens this wallet has already minted from the sale. */
  readonly mintedByWallet: number;
}

/** A citizen offered for a fixed price. The citizen stays with the seller until someone buys it. */
export interface MarketListing {
  readonly citizenId: number;
  /** Shortened address of the seller, as shown in the header. */
  readonly seller: string;
  readonly priceLamports: bigint;
  /** Season day the listing was made. */
  readonly listedDay: number;
}

/** One bid on an auction. Every bid is public, as it is on chain. */
export interface MarketBid {
  /** Shortened address of the bidder. */
  readonly bidder: string;
  readonly amountLamports: bigint;
  /** Unix seconds; `null` for a bid the chain shows but the server has not read yet. */
  readonly at: number | null;
  /** Placed by the connected wallet. */
  readonly mine: boolean;
}

/**
 * A citizen up for auction (D-0087). It stays in the seller's wallet, frozen,
 * until someone finishes the auction after it ends.
 */
export interface MarketAuction {
  readonly citizenId: number;
  /** Shortened address of the seller. */
  readonly seller: string;
  readonly startPriceLamports: bigint;
  /** `null` until the first bid. */
  readonly highestBidLamports: bigint | null;
  readonly bidCount: number;
  /**
   * The bids of this auction, newest first, so the first one is the highest.
   * It can hold fewer than `bidCount` when older bids were not read.
   */
  readonly bids: readonly MarketBid[];
  /** Unix seconds; a bid in the last ten minutes moves it later. */
  readonly endsAt: number;
  /** The smallest bid the auction takes now. */
  readonly minBidLamports: bigint;
  /** The connected wallet holds the highest bid. */
  readonly leading: boolean;
  /**
   * False once the seller took the market's right to move the citizen back.
   * No bid is taken then, and finishing the auction pays the highest bid back.
   */
  readonly deliverable: boolean;
}

/** Something that happened to the connected wallet in the market while it was away. */
export type MarketNotice =
  | {
      readonly id: string;
      readonly kind: 'sold';
      readonly citizenId: number;
      readonly priceLamports: bigint;
      /** What reached the wallet after the royalty. */
      readonly proceedsLamports: bigint;
      readonly viaAuction: boolean;
    }
  | { readonly id: string; readonly kind: 'won'; readonly citizenId: number; readonly priceLamports: bigint }
  | {
      readonly id: string;
      readonly kind: 'outbid';
      readonly citizenId: number;
      /** The wallet's bid, paid back in full. */
      readonly refundedLamports: bigint;
    }
  /** An auction the wallet won has ended and waits for it to claim the citizen. */
  | { readonly id: string; readonly kind: 'claim'; readonly citizenId: number; readonly priceLamports: bigint }
  /** An auction the wallet ran has ended with a winner and waits for it to collect the payment. */
  | { readonly id: string; readonly kind: 'collect'; readonly citizenId: number; readonly priceLamports: bigint };

/** The fixed-price market (D-0082): the listings and the rules every sale follows. */
export interface MarketSnapshot {
  /** False on a cluster where the market program is not deployed yet; nothing can be listed or bought. */
  readonly open: boolean;
  /** Creator royalty in basis points, taken out of the seller's side of every sale. */
  readonly royaltyBps: number;
  /** Lowest and highest price a listing can ask, in lamports. */
  readonly minPriceLamports: bigint;
  readonly maxPriceLamports: bigint;
  readonly listings: readonly MarketListing[];
  readonly auctions: readonly MarketAuction[];
  /** How long an auction may run, in hours of `auctionClock`. */
  readonly auctionHours: readonly number[];
  /**
   * How fast this market runs auctions: the real clock, or the devnet test
   * clock where an hour lasts seconds. Every time shown comes from `endsAt`;
   * this only names the lengths and the late-bid window.
   */
  readonly auctionClock: AuctionClock;
  /** For the connected wallet, newest first. The screens show each one once. */
  readonly notices: readonly MarketNotice[];
}

export interface DistrictSnapshot {
  readonly wallet: WalletView;
  /** Roster with canonical scores in `intelligence`, `alignment` and `compute`. */
  readonly citizens: readonly CitizenRecord[];
  readonly credits: Readonly<Record<number, StatCredits>>;
  readonly mint: MintStatus;
  readonly owned: readonly number[];
  readonly founding: readonly number[];
  readonly history: Readonly<Record<number, readonly HistoryEntry[]>>;
  readonly missions: readonly MissionDefinition[];
  readonly missionProgress: Readonly<Record<string, MissionProgress>>;
  readonly season: SeasonSnapshot;
  readonly market: MarketSnapshot;
}

export type DistrictActionError =
  | 'not-owner'
  | 'stat-at-max'
  | 'no-credit'
  | 'insufficient-balance'
  | 'district-locked'
  | 'mission-busy'
  | 'mission-closed'
  | 'citizen-busy'
  | 'mission-cooldown'
  | 'daily-limit'
  | 'invalid-stat'
  | 'sold-out'
  | 'mint-limit'
  | 'insufficient-sol'
  | 'mint-not-open'
  | 'wrong-answer'
  | 'wrong-order'
  | 'too-fast'
  | 'season-closed'
  | 'not-connected'
  | 'claim-pending'
  | 'declined'
  | 'transaction-failed'
  | 'unavailable'
  | 'market-closed'
  | 'listing-gone'
  | 'own-listing'
  | 'already-listed'
  | 'not-listed'
  | 'invalid-price'
  | 'price-changed'
  | 'in-auction'
  | 'bid-too-low'
  | 'already-highest'
  | 'auction-ended'
  | 'auction-live'
  | 'auction-has-bids';

export type DistrictActionResult =
  | { readonly ok: true; readonly snapshot: DistrictSnapshot }
  | { readonly ok: false; readonly error: DistrictActionError };

/** A mint also says which citizen the draw gave. */
export type MintActionResult =
  | { readonly ok: true; readonly snapshot: DistrictSnapshot; readonly citizenId: number }
  | { readonly ok: false; readonly error: DistrictActionError };

/**
 * The one door every screen uses to read and change district data (D-0020).
 * `mock` runs the program rules locally; `chain` will send transactions.
 */
export interface DistrictDataSource {
  readonly mode: 'mock' | 'chain';
  snapshot(): DistrictSnapshot;
  /**
   * Pay the mint price and receive one citizen. The draw is not the player's
   * choice: it comes from the mint, and the program registers it in the same
   * transaction (SPEC §6.3).
   */
  mintCitizen(): Promise<MintActionResult>;
  /** `upgrade_score`: spend one credit and burn the training cost. */
  upgradeScore(citizenId: number, stat: StatKey): Promise<DistrictActionResult>;
  /** Take a mission with one citizen; `stat` must be one of the mission's rewards. */
  startMission(citizenId: number, missionId: string, stat: StatKey): Promise<DistrictActionResult>;
  /**
   * Finish the current step with `proof`; the last one grants the credit
   * (`claim_training_credit`). A wrong answer is refused with `wrong-answer` or
   * `wrong-order` and leaves the step open.
   */
  advanceMission(citizenId: number, missionId: string, proof: StepProof): Promise<DistrictActionResult>;
  abandonMission(missionId: string): Promise<DistrictActionResult>;
  /** Offer an owned citizen for `priceLamports`. It stays in the wallet and keeps playing while listed. */
  listCitizen(citizenId: number, priceLamports: bigint): Promise<DistrictActionResult>;
  /** Change the price of a listing the wallet made. */
  changeListingPrice(citizenId: number, priceLamports: bigint): Promise<DistrictActionResult>;
  cancelListing(citizenId: number): Promise<DistrictActionResult>;
  /** Pay the asking price and take the citizen, in one step: either both happen or neither. */
  buyCitizen(citizenId: number): Promise<DistrictActionResult>;
  /** Put an owned citizen up for auction. It stays in the wallet, frozen, until the auction is finished. */
  auctionCitizen(citizenId: number, startPriceLamports: bigint, durationHours: number): Promise<DistrictActionResult>;
  /** Bid on an auction. The SOL is held by the market and comes back in full when someone bids more. */
  placeBid(citizenId: number, amountLamports: bigint): Promise<DistrictActionResult>;
  /** The seller takes the citizen back, only while nobody has bid. */
  cancelAuction(citizenId: number): Promise<DistrictActionResult>;
  /** Anyone finishes an ended auction: the citizen goes to the highest bidder and the seller is paid. */
  settleAuction(citizenId: number): Promise<DistrictActionResult>;
  /** Mock only: another player bids the least the auction takes. */
  simulateBid?(citizenId: number): Promise<DistrictActionResult>;
  /** Mock only: jump to the end of an auction. */
  simulateAuctionEnd?(citizenId: number): Promise<DistrictActionResult>;
  /** Mock only: let another player buy one of the wallet's listings, to see what a sale leaves behind. */
  simulateSale?(citizenId: number): Promise<DistrictActionResult>;
  /** Mock only: move the season clock one day forward to try the daily limits. */
  nextDay?(): Promise<DistrictActionResult>;
  /** Chain only: read everything again, after a change made outside this page. */
  refresh?(): Promise<DistrictActionResult>;
  /** Chain only: talk to the citizens the connected wallet owns. */
  readonly chat?: CitizenChatPort;
}
