import { formatSolExact, marketEventsFromLogs } from '@bas/chain-client';
import type { Address } from '@solana/kit';
import { Connection, PublicKey } from '@solana/web3.js';
import type { HistoryEvent } from './history.js';
import type { SeasonConfig } from './service.js';

/**
 * What happened in the market, read from the market program's transactions:
 * sales (a fixed-price `buy` or an auction that delivered) and bids. The
 * chain is the record; this is a reading of it, rebuilt on every start.
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
  readonly kind: 'fixed' | 'auction';
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
  const day = Math.floor((sale.at - season.startsAt) / 86_400) + 1;
  const when =
    day >= 1 && day <= season.days ? `on day ${day} of season ${season.id}` : `on ${new Date(sale.at * 1000).toISOString().slice(0, 10)}`;
  const how = sale.kind === 'auction' ? 'Won at auction' : 'Bought';
  return {
    asset: sale.asset,
    eventKey: `sale-${sale.signature}`.slice(0, 80),
    line: `${how} in the market for ${formatSolExact(BigInt(sale.priceLamports))} ${when}, and moved to a new owner.`,
  };
}

export interface MarketIndexerOptions {
  readonly source: MarketSource;
  readonly programId: string;
  /** Called once per sale this process has not seen before. Failures are the caller's to log. */
  readonly onSale?: (sale: SaleRecord) => void;
  /** Most entries of each kind kept in memory. */
  readonly limit?: number;
}

export class MarketIndexer {
  private readonly seen = new Set<string>();
  private sales: SaleRecord[] = [];
  private bids: BidRecord[] = [];
  /** Newest signature read, so the next sync stops there. */
  private newest: string | undefined;
  private running: Promise<void> | undefined;
  private readonly program: Address;

  constructor(private readonly options: MarketIndexerOptions) {
    this.program = options.programId as Address;
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

  private async read(): Promise<void> {
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
      this.seen.add(signature);
      const at = tx.blockTime ?? Math.floor(Date.now() / 1000);
      for (const event of marketEventsFromLogs(tx.logs, this.program)) {
        if (event.kind === 'sold' || (event.kind === 'auctionSettled' && event.delivered && event.winner)) {
          const sale: SaleRecord = {
            signature,
            asset: event.asset,
            seller: event.seller,
            buyer: event.kind === 'sold' ? event.buyer : (event.winner as string),
            priceLamports: event.priceLamports.toString(),
            sellerLamports: event.sellerLamports.toString(),
            kind: event.kind === 'sold' ? 'fixed' : 'auction',
            at,
          };
          this.sales = [sale, ...this.sales].slice(0, this.options.limit ?? 500);
          this.options.onSale?.(sale);
        } else if (event.kind === 'bidPlaced') {
          const bid: BidRecord = {
            signature,
            asset: event.asset,
            bidder: event.bidder,
            amountLamports: event.amountLamports.toString(),
            previousBidder: event.previousBidder,
            at,
          };
          this.bids = [bid, ...this.bids].slice(0, this.options.limit ?? 500);
        }
      }
      this.newest = signature;
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
