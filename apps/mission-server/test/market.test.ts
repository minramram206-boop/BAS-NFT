import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { MARKET_EVENT_DISCRIMINATORS } from '@bas/chain-client';
import { getAddressEncoder, type Address } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import { Authenticator, MarketIndexer, createMissionServer, describeSale, type MarketSource, type SaleRecord } from '../dist/index.js';
import { DAY, SEASON_START, rig } from './fixtures.ts';

const MARKET = 'EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP';
const key = () => Keypair.generate().publicKey.toBase58();
const encoder = getAddressEncoder();
const bytesOf = (value: string) => [...encoder.encode(value as Address)];
const u64 = (value: bigint) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, true);
  return [...out];
};
const data = (bytes: number[]) => `Program data: ${Buffer.from(bytes).toString('base64')}`;
const inMarket = (...lines: string[]) => [`Program ${MARKET} invoke [1]`, ...lines, `Program ${MARKET} success`];

const sold = (asset: string, seller: string, buyer: string, price: bigint) =>
  data([...MARKET_EVENT_DISCRIMINATORS.Sold, ...bytesOf(asset), ...bytesOf(seller), ...bytesOf(buyer), ...u64(price), ...u64(price / 20n), ...u64(0n), ...u64(price - price / 20n)]);
const settled = (asset: string, seller: string, winner: string | null, price: bigint, delivered: boolean) =>
  data([
    ...MARKET_EVENT_DISCRIMINATORS.AuctionSettled,
    ...bytesOf(asset),
    ...bytesOf(seller),
    ...(winner ? bytesOf(winner) : new Array(32).fill(0)),
    ...u64(price),
    ...u64(delivered ? price / 20n : 0n),
    ...u64(0n),
    ...u64(delivered ? price - price / 20n : 0n),
    delivered ? 1 : 0,
  ]);
const bid = (asset: string, bidder: string, amount: bigint, previous: string | null) =>
  data([...MARKET_EVENT_DISCRIMINATORS.BidPlaced, ...bytesOf(asset), ...bytesOf(bidder), ...u64(amount), ...(previous ? bytesOf(previous) : new Array(32).fill(0)), ...u64(previous ? amount - 1n : 0n), ...u64(99n)]);

/** A chain of market transactions in memory; `push` adds the newest. */
class FakeSource implements MarketSource {
  readonly txs: { signature: string; failed: boolean; logs: string[]; blockTime: number }[] = [];
  lookups = 0;
  push(logs: string[], blockTime = SEASON_START + 3 * DAY, failed = false): string {
    const signature = `sig${this.txs.length}`;
    this.txs.push({ signature, failed, logs, blockTime });
    return signature;
  }
  async signatures(_program: string, before?: string) {
    const newestFirst = [...this.txs].reverse();
    const from = before ? newestFirst.findIndex((tx) => tx.signature === before) + 1 : 0;
    return newestFirst.slice(from).map(({ signature, failed }) => ({ signature, failed }));
  }
  async transaction(signature: string) {
    this.lookups += 1;
    const tx = this.txs.find((item) => item.signature === signature);
    return tx ? { logs: tx.logs, blockTime: tx.blockTime } : null;
  }
}

const SEASON = { id: 1, startsAt: SEASON_START, days: 28 };

describe('market activity', () => {
  it('reads fixed-price and auction sales and bids, newest first, once each', async () => {
    const source = new FakeSource();
    const [asset, other, seller, buyer, bidder] = [key(), key(), key(), key(), key()];
    source.push(inMarket('Program log: Instruction: Buy', sold(asset, seller, buyer, 100_000_000n)));
    source.push(inMarket(bid(other, bidder, 10_000_000n, null)));
    source.push(inMarket(bid(other, buyer, 10_500_000n, bidder)));
    source.push(inMarket(sold(asset, buyer, seller, 1n)), SEASON_START, true); // failed: not a sale
    source.push(inMarket(settled(other, seller, null, 0n, false))); // nobody bid
    const reported: SaleRecord[] = [];
    const indexer = new MarketIndexer({ source, programId: MARKET, onSale: (sale) => reported.push(sale) });

    await indexer.sync();
    let { sales, bids } = indexer.activity();
    assert.equal(sales.length, 1);
    assert.deepEqual(sales[0], {
      signature: 'sig0',
      asset,
      seller,
      buyer,
      priceLamports: '100000000',
      sellerLamports: '95000000',
      kind: 'fixed',
      at: SEASON_START + 3 * DAY,
    });
    assert.deepEqual(
      bids.map((entry) => [entry.bidder, entry.amountLamports, entry.previousBidder]),
      [
        [buyer, '10500000', bidder],
        [bidder, '10000000', null],
      ],
    );

    // A later sync reads only what is new, and reports each sale once.
    source.push(inMarket(settled(other, seller, buyer, 10_500_000n, true)));
    const lookups = source.lookups;
    await indexer.sync();
    await indexer.sync();
    ({ sales } = indexer.activity());
    assert.equal(source.lookups - lookups, 1);
    assert.deepEqual(
      sales.map((entry) => [entry.kind, entry.asset, entry.buyer]),
      [
        ['auction', other, buyer],
        ['fixed', asset, buyer],
      ],
    );
    assert.deepEqual(reported.map((sale) => sale.signature), ['sig0', 'sig5']);
  });

  it('ignores event bytes another program wrote in the same transaction', async () => {
    const source = new FakeSource();
    source.push(['Program Other111111111111111111111111111111111 invoke [1]', sold(key(), key(), key(), 5n), 'Program Other111111111111111111111111111111111 success']);
    const indexer = new MarketIndexer({ source, programId: MARKET });
    await indexer.sync();
    assert.deepEqual(indexer.activity().sales, []);
  });

  it('writes a public line that gives the price and the day, and names no wallet', () => {
    const seller = key();
    const sale: SaleRecord = { signature: 's'.repeat(88), asset: key(), seller, buyer: key(), priceLamports: '100000000', sellerLamports: '95000000', kind: 'fixed', at: SEASON_START + 4 * DAY + 60 };
    const line = describeSale(sale, SEASON);
    assert.equal(line.line, 'Bought in the market for 0.10 SOL on day 5 of season 1, and moved to a new owner.');
    assert.ok(line.eventKey.length <= 80 && line.eventKey.startsWith('sale-'));
    assert.ok(!line.line.includes(seller) && !line.line.includes(sale.buyer));
    const late = describeSale({ ...sale, kind: 'auction', at: SEASON_START + 40 * DAY }, SEASON);
    assert.match(late.line, /^Won at auction in the market for 0\.10 SOL on \d{4}-\d{2}-\d{2}, and moved to a new owner\.$/);
  });

  it('serves the activity without a token', async () => {
    const source = new FakeSource();
    const [asset, seller, buyer] = [key(), key(), key()];
    source.push(inMarket(sold(asset, seller, buyer, 650_000_000n)));
    const market = new MarketIndexer({ source, programId: MARKET });
    await market.sync();
    const server = createMissionServer({ service: rig().service, auth: new Authenticator(Buffer.alloc(32, 5)), allowedOrigins: [], market });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const body = (await (await fetch(`${base}/market/activity`)).json()) as { sales: SaleRecord[]; bids: unknown[] };
      assert.equal(body.sales[0]?.priceLamports, '650000000');
      assert.deepEqual(body.bids, []);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
