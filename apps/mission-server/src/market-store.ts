import { ServiceUnreachableError, openDatabase, type createPool } from '@bas/chat-store';
import type { BidRecord, MarketStore, SaleRecord } from './market.js';

type Pool = ReturnType<typeof createPool>;

interface SaleRow {
  signature: string;
  asset: string;
  seller: string;
  buyer: string;
  price_lamports: string;
  seller_lamports: string;
  kind: 'fixed' | 'auction' | 'offer';
  at: string;
}

interface BidRow {
  signature: string;
  asset: string;
  bidder: string;
  amount_lamports: string;
  previous_bidder: string | null;
  at: string;
}

/**
 * The market history in Postgres (D-0093), in the tables of migration
 * `0002-market`. Rows belong to one market program, so a new program id
 * starts a history of its own. Lamports are stored as `numeric` and read back
 * as the same decimal strings.
 */
export class PgMarketStore implements MarketStore {
  constructor(
    private readonly pool: Pool,
    private readonly program: string,
  ) {}

  async load(): Promise<{ sales: SaleRecord[]; bids: BidRecord[]; cursor: string | null }> {
    const [sales, bids, cursor] = await Promise.all([
      this.pool.query<SaleRow>(
        `SELECT signature, asset, seller, buyer, price_lamports::text, seller_lamports::text, kind, at::text
         FROM market_sales WHERE program = $1 ORDER BY id DESC`,
        [this.program],
      ),
      this.pool.query<BidRow>(
        `SELECT signature, asset, bidder, amount_lamports::text, previous_bidder, at::text
         FROM market_bids WHERE program = $1 ORDER BY id DESC`,
        [this.program],
      ),
      this.pool.query<{ signature: string }>('SELECT signature FROM market_cursor WHERE program = $1', [this.program]),
    ]);
    return {
      sales: sales.rows.map((row) => ({
        signature: row.signature,
        asset: row.asset,
        seller: row.seller,
        buyer: row.buyer,
        priceLamports: row.price_lamports,
        sellerLamports: row.seller_lamports,
        kind: row.kind,
        at: Number(row.at),
      })),
      bids: bids.rows.map((row) => ({
        signature: row.signature,
        asset: row.asset,
        bidder: row.bidder,
        amountLamports: row.amount_lamports,
        previousBidder: row.previous_bidder,
        at: Number(row.at),
      })),
      cursor: cursor.rows[0]?.signature ?? null,
    };
  }

  async record(signature: string, sales: readonly SaleRecord[], bids: readonly BidRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const sale of sales) {
        await client.query(
          `INSERT INTO market_sales (program, signature, asset, seller, buyer, price_lamports, seller_lamports, kind, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (program, signature, asset) DO NOTHING`,
          [this.program, sale.signature, sale.asset, sale.seller, sale.buyer, sale.priceLamports, sale.sellerLamports, sale.kind, sale.at],
        );
      }
      for (const bid of bids) {
        await client.query(
          `INSERT INTO market_bids (program, signature, asset, bidder, amount_lamports, previous_bidder, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (program, signature, asset, bidder) DO NOTHING`,
          [this.program, bid.signature, bid.asset, bid.bidder, bid.amountLamports, bid.previousBidder, bid.at],
        );
      }
      await client.query(
        `INSERT INTO market_cursor (program, signature) VALUES ($1, $2)
         ON CONFLICT (program) DO UPDATE SET signature = EXCLUDED.signature, updated_at = now()`,
        [this.program, signature],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * The Postgres pool for the market history and the dismissed market notices,
 * or `undefined` when there is none. Both then live in this process, as
 * before; missions and the market do not depend on them, so a database that
 * is not configured or not answering must not keep the server from starting.
 */
export async function openMarketDatabase(
  url: string | undefined,
  log: Pick<Console, 'log' | 'warn'> = console,
): Promise<Pool | undefined> {
  if (!url) {
    log.log('[mission-server] DATABASE_URL is not set: the market history and dismissed notices are kept in this process only');
    return undefined;
  }
  try {
    return await openDatabase(url);
  } catch (error) {
    if (!(error instanceof ServiceUnreachableError)) throw error;
    log.warn(
      `[mission-server] ${error.message} The market history and dismissed notices are kept in this process only until the server is restarted.`,
    );
    return undefined;
  }
}
