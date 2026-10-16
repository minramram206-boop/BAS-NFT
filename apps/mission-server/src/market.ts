import { formatSolExact, marketEventsFromLogs } from '@bas/chain-client';
import type { Address } from '@solana/kit';
import { Connection, PublicKey } from '@solana/web3.js';
import type { HistoryEvent } from './history.js';
import type { SeasonConfig } from './service.js';

/**
 * What happened in the market, read from the market program's transactions:
 * sales (a fixed-price `buy`, an auction that delivered, or an accepted
 * offer) and bids. The
 * chain is the record; this is a reading of it. With a `MarketStore` the
 * reading is kept in full and a restart goes on from the last transaction
 * read; without one it lives in this process and is rebuilt on every start.
 */

/** One sale, as the web app and the public history use it. Lamports are decimal strings. */
export interface SaleRecord {
  readonly signature: string;
  readonly asset: string;
  readonly seller: string;
  readonly buyer: string;
  readonly priceLamports: string;
  /** What reached the seller after the royalty and fee. */
  readonly sellerLamports: string;
  readonly kind: 'fixed' | 'auction' | 'offer';
  /** Unix seconds of the block. */
  readonly at: number;
}

export interface BidRecord {
  readonly signature: string;
  readonly asset: string;
  readonly bidder: string;
  readonly amountLamports: string;
  /** Outbid and paid back by this bid; `null` for the first bid of an auction. */
  readonly previousBidder: string | null;
  readonly at: number;
}

export interface MarketActivity {
  readonly sales: readonly SaleRecord[];
  readonly bids: readonly BidRecord[];
}

/**
 * Where the reading is kept between starts. `record` takes the sales and bids
 * of one transaction and moves the cursor to it in the same step, so a crash
 * never leaves records without the cursor or the other way round. Recording a
 * transaction again changes nothing.
 */
export interface MarketStore {
  /** Everything kept, newest first, and the newest transaction read. */
  load(): Promise<{ sales: SaleRecord[]; bids: BidRecord[]; cursor: string | null }>;
  record(signature: string, sales: readonly SaleRecord[], bids: readonly BidRecord[]): Promise<void>;
}

/** The RPC calls the reader needs, behind an interface so tests can replace them. */
export interface MarketSource {
  /** Signatures of transactions that touched `program`, newest first, older than `before`. */
  signatures(program: string, before?: string): Promise<readonly { signature: string; failed: boolean }[]>;
  /** Log lines and block time of a confirmed transaction, or `null` when the node does not have it. */
  transaction(signature: string): Promise<{ logs: readonly string[]; blockTime: number | null } | null>;
}

export function rpcMarketSource(rpcUrl: string): MarketSource {
  const connection = new Connection(rpcUrl, 'confirmed');
  return {
    async signatures(program, before) {
      const page = await connection.getSignaturesForAddress(new PublicKey(program), { limit: 1_000, ...(before ? { before } : {}) }, 'confirmed');
      return page.map((entry) => ({ signature: entry.signature, failed: entry.err !== null }));
    },
    async transaction(signature) {
      const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx) return null;
      return { logs: tx.meta?.logMessages ?? [], blockTime: tx.blockTime ?? null };
    },
  };
}

/**
 * The public history line for a sale. Like the mission line, it states only
 * what the chain already makes public: the price and when. It names no wallet.
 */
export function describeSale(sale: SaleRecord, season: SeasonConfig): HistoryEvent {
  const day = Math.floor((sale.at - season.startsAt) / (season.daySeconds ?? 86_400)) + 1;
  const when =
    day >= 1 && day <= season.days ? `on day ${day} of season ${season.id}` : `on ${new Date(sale.at * 1000).toISOString().slice(0, 10)}`;
  const how = sale.kind === 'auction' ? 'Won at auction' : sale.kind === 'offer' ? 'Sold on an accepted offer' : 'Bought';
  return {
    asset: sale.asset,
    eventKey: `sale-${sale.signature}`.slice(0, 80),
    line: `${how} in the market for ${formatSolExact(BigInt(sale.priceLamports))} ${when}, and moved to a new owner.`,
  };
}

export interface MarketIndexerOptions {
  readonly source: MarketSource;
  readonly programId: string;
  /** Called once per sale not read before, by this process or, with a store, any earlier one. Failures are the caller's to log. */
  readonly onSale?: (sale: SaleRecord) => void;
  /** Keeps the reading between starts; then nothing is dropped. */
  readonly store?: MarketStore;
  /** Most entries of each kind kept without a store. */
  readonly limit?: number;
}

const saleKey = (sale: SaleRecord) => `${sale.signature}:${sale.asset}`;
const bidKey = (bid: BidRecord) => `${bid.signature}:${bid.asset}:${bid.bidder}`;

export class MarketIndexer {
  private readonly seen = new Set<string>();
  private sales: SaleRecord[] = [];
  private bids: BidRecord[] = [];
  /** Newest signature read, so the next sync stops there. */
  private newest: string | undefined;
  private running: Promise<void> | undefined;
  private loaded = false;
  /** Keys of the records held, so a transaction read twice is not listed twice. */
  private readonly held = new Set<string>();
  private readonly program: Address;
  private readonly limit: number;

  constructor(private readonly options: MarketIndexerOptions) {
    this.program = options.programId as Address;
    this.limit = options.store ? Number.POSITIVE_INFINITY : (options.limit ?? 500);
  }

  activity(): MarketActivity {
    return { sales: [...this.sales], bids: [...this.bids] };
  }

  /** Reads the transactions since the last sync. Concurrent calls share one run. */
  sync(): Promise<void> {
    this.running ??= this.read().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** What the store kept, once, before the first read of the chain. */
  private async load(): Promise<void> {
    if (this.loaded) return;
    if (this.options.store) {
      const kept = await this.options.store.load();
      this.sales = kept.sales;
      this.bids = kept.bids;
      this.newest = kept.cursor ?? undefined;
      for (const sale of kept.sales) this.held.add(saleKey(sale));
      for (const bid of kept.bids) this.held.add(bidKey(bid));
    }
    this.loaded = true;
  }

  private async read(): Promise<void> {
    await this.load();
    const fresh: string[] = [];
    let before: string | undefined;
    pages: for (;;) {
      const page = await this.options.source.signatures(this.options.programId, before);
      for (const entry of page) {
        if (entry.signature === this.newest) break pages;
        if (!entry.failed && !this.seen.has(entry.signature)) fresh.push(entry.signature);
      }
      if (page.length === 0) break;
      before = page[page.length - 1]?.signature;
      if (page.length < 1_000) break;
    }
    if (fresh.length === 0) return;

    // Oldest first, so the lists end up newest first and callbacks run in order.
    for (const signature of fresh.reverse()) {
      const tx = await this.options.source.transaction(signature);
      if (!tx) return; // the node is behind; try again on the next sync
      const at = tx.blockTime ?? Math.floor(Date.now() / 1000);
      const sales: SaleRecord[] = [];
      const bids: BidRecord[] = [];
      for (const event of marketEventsFromLogs(tx.logs, this.program)) {
        if (event.kind === 'sold' || event.kind === 'offerAccepted' || (event.kind === 'auctionSettled' && event.delivered && event.winner)) {
          sales.push({
            signature,
            asset: event.asset,
            seller: event.seller,
            buyer: event.kind === 'auctionSettled' ? (event.winner as string) : event.buyer,
            priceLamports: event.priceLamports.toString(),
            sellerLamports: event.sellerLamports.toString(),
            kind: event.kind === 'sold' ? 'fixed' : event.kind === 'offerAccepted' ? 'offer' : 'auction',
            at,
          });
        } else if (event.kind === 'bidPlaced') {
          bids.push({
            signature,
            asset: event.asset,
            bidder: event.bidder,
            amountLamports: event.amountLamports.toString(),
            previousBidder: event.previousBidder,
            at,
          });
        }
      }
      // Kept first: if that fails, this transaction is read again on the next sync.
      await this.options.store?.record(signature, sales, bids);
      this.seen.add(signature);
      this.newest = signature;
      for (const sale of sales) {
        if (this.held.has(saleKey(sale))) continue;
        this.held.add(saleKey(sale));
        this.sales = [sale, ...this.sales].slice(0, this.limit);
        this.options.onSale?.(sale);
      }
      for (const bid of bids) {
        if (this.held.has(bidKey(bid))) continue;
        this.held.add(bidKey(bid));
        this.bids = [bid, ...this.bids].slice(0, this.limit);
      }
    }
  }

  /** Syncs now and then every `intervalMs`; errors are logged, never thrown. */
  start(intervalMs: number, log: Pick<Console, 'error'> = console): () => void {
    const tick = () =>
      this.sync().catch((error: unknown) => {
        log.error(`[mission-server] could not read the market: ${error instanceof Error ? error.message : String(error)}`);
      });
    void tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
