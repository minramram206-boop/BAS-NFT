import type {
  AuctionOnChain,
  CitizenStateOnChain,
  CorePluginAuthority,
  ListingOnChain,
  MarketConfigOnChain,
  OfferOnChain,
} from '@bas/chain-client/browser';
import type { StatKey } from '@bas/content';
import type { DistrictActionResult, DistrictDataSource, StepProof } from '../types';

/**
 * Ports of the chain data source. Everything that touches the network or a
 * wallet sits behind one of these, so the rules in `chainDataSource.ts` run
 * the same against a real cluster and against the fakes in the tests.
 */

/** A citizen asset of the collection, joined with its registered state. */
export interface ChainCitizen {
  /** Address of the Core asset. */
  readonly asset: string;
  /** Current holder of the asset. */
  readonly owner: string;
  /** Serial from the metadata file name; `null` when the file does not follow the naming rule. */
  readonly serial: number | null;
  /** `null` until `register_citizen` has run for this asset. */
  readonly state: CitizenStateOnChain | null;
  /** Authority of the asset's TransferDelegate plugin; `null` when it has none. */
  readonly transferDelegate: CorePluginAuthority | null;
  /** Authority of the asset's FreezeDelegate plugin; `null` when it has none. */
  readonly freezeDelegate: CorePluginAuthority | null;
  /** True while a FreezeDelegate plugin holds the asset; no transfer goes through then. */
  readonly frozen: boolean;
}

export interface Balances {
  readonly solLamports: bigint;
  /** Utility token in atoms; zero when the wallet has no token account. */
  readonly tokenAtoms: bigint;
}

/** The public sale as the Candy Machine account and the wallet's mint counter show it. */
export interface SaleReading {
  /** Citizens the machine was created with: the real supply. */
  readonly itemsAvailable: number;
  /** Citizens minted so far. */
  readonly itemsRedeemed: number;
  /** Mints this wallet made from the sale; zero without a wallet. */
  readonly mintedByWallet: number;
}

/** The market program's state: its config and every listing, valid or not. */
export interface MarketReading {
  readonly config: MarketConfigOnChain;
  /** The PDA sellers name as their asset's transfer delegate. */
  readonly authority: string;
  readonly listings: readonly ListingOnChain[];
  readonly auctions: readonly AuctionOnChain[];
  /** Every open or expired offer the program holds; an offer closes when accepted or taken back. */
  readonly offers: readonly OfferOnChain[];
  /** Rent of a new offer account, which its buyer gets back when it closes. */
  readonly offerDepositLamports: bigint;
}

/** Reads of the cluster. */
export interface DistrictReads {
  /** Every asset of the official collection with its district state. */
  citizens(): Promise<readonly ChainCitizen[]>;
  balances(owner: string): Promise<Balances>;
  /** The Candy Machine and the wallet's counter, or `null` when the sale is not set up on this cluster. */
  sale(wallet: string | null): Promise<SaleReading | null>;
  /** The market, or `null` when this cluster has no market program or its config is not set up. */
  market(): Promise<MarketReading | null>;
}

/** What a connected wallet can do. Both calls may be refused by the person. */
export interface WalletSession {
  readonly address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Takes and returns a serialized transaction; the wallet adds its signature. */
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}

/** Thrown by a `WalletSession` when the person closes the request. */
export class WalletDeclinedError extends Error {
  constructor(message = 'The wallet request was declined') {
    super(message);
    this.name = 'WalletDeclinedError';
  }
}

/** Builds and sends the transactions the program accepts from the owner. */
export interface DistrictTransactions {
  /** An unsigned `upgrade_score` transaction paid by `owner`. */
  buildUpgradeScore(input: { owner: string; asset: string; stat: StatKey }): Promise<Uint8Array>;
  /**
   * An unsigned listing: closes a previous owner's leftover listing, names the
   * market as transfer delegate when it is not already, and lists the citizen.
   */
  buildListCitizen(input: {
    seller: string;
    asset: string;
    priceLamports: bigint;
    transferDelegate: CorePluginAuthority | null;
    staleListingSeller: string | null;
  }): Promise<Uint8Array>;
  buildChangeListingPrice(input: { seller: string; asset: string; priceLamports: bigint }): Promise<Uint8Array>;
  /** `cancel_listing`, plus taking the delegate back from the market while it holds it. */
  buildCancelListing(input: { seller: string; asset: string; transferDelegate: CorePluginAuthority | null }): Promise<Uint8Array>;
  /** `buy`, refused by the program if the listing now asks more than `maxPriceLamports`. */
  buildBuyCitizen(input: {
    buyer: string;
    asset: string;
    seller: string;
    maxPriceLamports: bigint;
    config: Pick<MarketConfigOnChain, 'collection' | 'royaltyRecipient' | 'feeRecipient'>;
  }): Promise<Uint8Array>;
  /** An unsigned auction: `create_auction`, which hands the citizen to the market until it ends. */
  buildStartAuction(input: {
    seller: string;
    asset: string;
    startPriceLamports: bigint;
    durationHours: number;
    staleListingSeller: string | null;
  }): Promise<Uint8Array>;
  /** `place_bid`, naming the current highest bidder so the program can pay them back. */
  buildPlaceBid(input: { bidder: string; asset: string; amountLamports: bigint; previousBidder: string | null }): Promise<Uint8Array>;
  /** `cancel_auction`, which hands the citizen back; for an older auction, also the delegates the market still holds. */
  buildCancelAuction(input: {
    seller: string;
    asset: string;
    transferDelegate: CorePluginAuthority | null;
    freezeDelegate: CorePluginAuthority | null;
  }): Promise<Uint8Array>;
  /** `settle_auction`, paid by `caller`. */
  buildSettleAuction(input: {
    caller: string;
    auction: Pick<AuctionOnChain, 'asset' | 'seller' | 'highestBidder'>;
    config: Pick<MarketConfigOnChain, 'collection' | 'royaltyRecipient' | 'feeRecipient'>;
  }): Promise<Uint8Array>;
  /** `make_offer`: a new offer, or one that replaces the buyer's earlier offer on this citizen. */
  buildMakeOffer(input: { buyer: string; asset: string; amountLamports: bigint; days: number }): Promise<Uint8Array>;
  /** `withdraw_offer`: the buyer takes the offer back, open or expired. */
  buildWithdrawOffer(input: { buyer: string; asset: string }): Promise<Uint8Array>;
  /** `accept_offer`, refused by the program if the offer is no longer `amountLamports`. */
  buildAcceptOffer(input: {
    owner: string;
    buyer: string;
    asset: string;
    amountLamports: bigint;
    /** The owner has the citizen listed; the listing closes with the sale. */
    listed: boolean;
    config: Pick<MarketConfigOnChain, 'collection' | 'royaltyRecipient' | 'feeRecipient'>;
  }): Promise<Uint8Array>;
  /** Sends a signed transaction and resolves with its signature once it is confirmed. */
  send(signed: Uint8Array): Promise<string>;
}

/** The data source plus what the app needs to connect a wallet and re-read the cluster. */
export interface ChainDataSource extends DistrictDataSource {
  readonly mode: 'chain';
  /** Connect (or, with `null`, disconnect) a wallet and read its citizens. */
  setWallet(session: WalletSession | null): Promise<DistrictActionResult>;
  refresh(): Promise<DistrictActionResult>;
}

export type { StepProof };
