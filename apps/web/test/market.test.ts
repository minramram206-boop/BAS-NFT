import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadCitizens } from '@bas/content/server';

import {
  MAX_PRICE_LAMPORTS,
  MIN_PRICE_LAMPORTS,
  ROYALTY_BPS,
  AUCTION_CLOCKS,
  bidFeed,
  clockSpan,
  endAfterBid,
  formatSolExact,
  markNoticesSeen,
  minNextBid,
  parseSolInput,
  priceProblem,
  shownAuctions,
  shownListings,
  solInputText,
  splitSale,
  suggestedBid,
  timeAgoText,
  timeLeftText,
  unseenNotices,
} from '../src/lib/data/market.ts';
import { createMockDataSource } from '../src/lib/data/mock/mockDataSource.ts';
import type { DistrictDataSource, MarketAuction, MarketListing } from '../src/lib/data/types.ts';

const roster = loadCitizens();
const SOL = 1_000_000_000n;

const source = (price = '10000000'): DistrictDataSource =>
  createMockDataSource({ roster, baseTrainingCostAtoms: '100000000', mintPriceLamports: price, mintLimitPerWallet: 2, random: () => 0 });

/** The wallet owns 1, 2 and 4; these are on sale from other players at the prices in `mockSnapshot.ts`. */
const MILO = 3;
/** The dearest listing, more than the wallet holds once it has bought Milo. */
const DEAREST = 11;
const FARMER = 1;

describe('typed prices', () => {
  it('reads SOL into lamports without rounding', () => {
    assert.equal(parseSolInput('1'), SOL);
    assert.equal(parseSolInput('0.65'), 650_000_000n);
    assert.equal(parseSolInput('.5'), 500_000_000n);
    assert.equal(parseSolInput(' 0.5 '), 500_000_000n);
    assert.equal(parseSolInput('12.123456789'), 12_123_456_789n);
  });

  it('takes a comma as the decimal mark', () => {
    assert.equal(parseSolInput('0,65'), 650_000_000n);
  });

  it('refuses anything that is not a plain decimal number of SOL', () => {
    for (const text of ['', ' ', '.', ',', '1.2.3', '1e3', '-1', '+1', 'abc', '1 SOL', '0.1234567891', '1,000.5']) {
      assert.equal(parseSolInput(text), null, JSON.stringify(text));
    }
  });

  it('writes a price back the way it was typed, so editing a listing starts from its price', () => {
    for (const lamports of [10_000_000n, 15_000_000n, 650_000_000n, SOL, 12_123_456_789n, 1_000n * SOL]) {
      assert.equal(parseSolInput(solInputText(lamports)), lamports);
    }
    assert.equal(solInputText(SOL), '1');
    assert.equal(solInputText(650_000_000n), '0.65');
  });

  it('keeps every digit that matters when showing a price', () => {
    assert.equal(formatSolExact(650_000_000n), '0.65 SOL');
    assert.equal(formatSolExact(1_500_000_000n), '1.50 SOL');
    assert.equal(formatSolExact(15_000_000n), '0.015 SOL');
    assert.equal(formatSolExact(1_234n * SOL), '1,234.00 SOL');
    assert.equal(formatSolExact(1n), '0.000000001 SOL');
  });
});

describe('price rules', () => {
  const rules = { minPriceLamports: MIN_PRICE_LAMPORTS, maxPriceLamports: MAX_PRICE_LAMPORTS };

  it('accepts the two limits and nothing outside them', () => {
    assert.equal(priceProblem(MIN_PRICE_LAMPORTS, rules), null);
    assert.equal(priceProblem(MAX_PRICE_LAMPORTS, rules), null);
    assert.equal(priceProblem(MIN_PRICE_LAMPORTS - 1n, rules), 'too-low');
    assert.equal(priceProblem(0n, rules), 'too-low');
    assert.equal(priceProblem(MAX_PRICE_LAMPORTS + 1n, rules), 'too-high');
  });

  it('splits a sale so that the royalty and the proceeds always add up to the price', () => {
    assert.deepEqual(splitSale(SOL, ROYALTY_BPS), { royaltyLamports: 50_000_000n, proceedsLamports: 950_000_000n });
    assert.deepEqual(splitSale(650_000_000n, ROYALTY_BPS), { royaltyLamports: 32_500_000n, proceedsLamports: 617_500_000n });
    for (const price of [MIN_PRICE_LAMPORTS, 10_000_001n, 123_456_789n, 3_100_000_000n, MAX_PRICE_LAMPORTS]) {
      const split = splitSale(price, ROYALTY_BPS);
      assert.equal(split.royaltyLamports + split.proceedsLamports, price);
      assert.ok(split.royaltyLamports <= (price * 5n) / 100n, 'the royalty is rounded down, never up');
    }
  });
});

describe('what is shown', () => {
  const listings = source().snapshot().market.listings;
  const citizens = source().snapshot().citizens;
  const ids = (shown: readonly MarketListing[]) => shown.map((listing) => listing.citizenId);

  it('filters by role', () => {
    assert.deepEqual(ids(shownListings(listings, citizens, { role: 'steward', sort: 'priceLow' })), [MILO, 19]);
    assert.deepEqual(ids(shownListings(listings, citizens, { role: 'pioneer', sort: 'priceLow' })), []);
    assert.equal(shownListings(listings, citizens, { role: 'all', sort: 'newest' }).length, listings.length);
  });

  it('sorts by price both ways', () => {
    const low = ids(shownListings(listings, citizens, { role: 'all', sort: 'priceLow' }));
    assert.deepEqual(low, [MILO, 19, 8, DEAREST]);
    assert.deepEqual(ids(shownListings(listings, citizens, { role: 'all', sort: 'priceHigh' })), [...low].reverse());
  });

  it('puts the most recent listing first and the strongest citizen first', () => {
    const newest = shownListings(listings, citizens, { role: 'all', sort: 'newest' });
    assert.deepEqual(
      newest.map((listing) => listing.listedDay),
      [...newest.map((listing) => listing.listedDay)].sort((a, b) => b - a),
    );
    const strongest = shownListings(listings, citizens, { role: 'all', sort: 'strongest' });
    const best = (id: number) => {
      const citizen = citizens.find((item) => item.id === id);
      assert.ok(citizen);
      return Math.max(citizen.intelligence, citizen.alignment, citizen.compute);
    };
    const scores = strongest.map((listing) => best(listing.citizenId));
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it('leaves out a listing whose citizen is not in the district', () => {
    const stray: MarketListing = { citizenId: 999, seller: 'x', priceLamports: SOL, listedDay: 1 };
    assert.equal(shownListings([stray], citizens, { role: 'all', sort: 'newest' }).length, 0);
  });
});

describe('the preview market', () => {
  it('opens with other players\' citizens for sale and none of the wallet\'s own', () => {
    const { market, owned, citizens } = source().snapshot();
    assert.equal(market.open, true);
    assert.equal(market.royaltyBps, ROYALTY_BPS);
    assert.equal(market.listings.length, 4);
    for (const listing of market.listings) {
      assert.ok(!(owned as readonly number[]).includes(listing.citizenId));
      assert.ok(citizens.some((citizen) => citizen.id === listing.citizenId));
    }
  });

  it('is empty for a wallet that starts without citizens only of its own, not of others', () => {
    const empty = createMockDataSource({ roster, baseTrainingCostAtoms: '1', mintPriceLamports: '1', mintLimitPerWallet: 1, start: 'empty' });
    assert.equal(empty.snapshot().market.listings.length, 4);
  });

  describe('listing', () => {
    it('lists an owned citizen at the asking price on the current day', async () => {
      const data = source();
      const result = await data.listCitizen(FARMER, 2n * SOL);
      assert.ok(result.ok);
      const listing = data.snapshot().market.listings.find((item) => item.citizenId === FARMER);
      assert.deepEqual(listing, {
        citizenId: FARMER,
        seller: data.snapshot().wallet.label,
        priceLamports: 2n * SOL,
        listedDay: data.snapshot().season.day,
      });
    });

    it('keeps the citizen with its owner while it is listed', async () => {
      const data = source();
      await data.listCitizen(FARMER, SOL);
      assert.ok(data.snapshot().owned.includes(FARMER));
      const started = await data.upgradeScore(FARMER, 'compute');
      assert.ok(started.ok, 'a listed citizen can still be trained');
    });

    it('refuses a citizen the wallet does not own, a second listing and a price outside the limits', async () => {
      const data = source();
      assert.deepEqual(await data.listCitizen(MILO, SOL), { ok: false, error: 'not-owner' });
      assert.ok((await data.listCitizen(FARMER, SOL)).ok);
      assert.deepEqual(await data.listCitizen(FARMER, SOL), { ok: false, error: 'already-listed' });
      assert.deepEqual(await data.listCitizen(2, MIN_PRICE_LAMPORTS - 1n), { ok: false, error: 'invalid-price' });
      assert.deepEqual(await data.listCitizen(2, MAX_PRICE_LAMPORTS + 1n), { ok: false, error: 'invalid-price' });
      assert.equal(data.snapshot().market.listings.filter((item) => item.citizenId === 2).length, 0);
    });

    it('changes the price of a listing, and only of one that exists', async () => {
      const data = source();
      assert.deepEqual(await data.changeListingPrice(FARMER, SOL), { ok: false, error: 'not-listed' });
      await data.listCitizen(FARMER, SOL);
      assert.ok((await data.changeListingPrice(FARMER, 3n * SOL)).ok);
      assert.equal(data.snapshot().market.listings.find((item) => item.citizenId === FARMER)?.priceLamports, 3n * SOL);
      assert.deepEqual(await data.changeListingPrice(FARMER, 0n), { ok: false, error: 'invalid-price' });
      assert.deepEqual(await data.changeListingPrice(MILO, SOL), { ok: false, error: 'not-owner' });
    });

    it('cancels a listing', async () => {
      const data = source();
      await data.listCitizen(FARMER, SOL);
      assert.ok((await data.cancelListing(FARMER)).ok);
      assert.equal(data.snapshot().market.listings.some((item) => item.citizenId === FARMER), false);
      assert.deepEqual(await data.cancelListing(FARMER), { ok: false, error: 'not-listed' });
      assert.deepEqual(await data.cancelListing(MILO), { ok: false, error: 'not-owner' });
    });
  });

  describe('buying', () => {
    it('pays the asking price, takes the citizen and adds the sale to its public history', async () => {
      const data = source();
      const before = data.snapshot();
      const price = before.market.listings.find((item) => item.citizenId === MILO)?.priceLamports;
      assert.equal(price, 450_000_000n);

      const result = await data.buyCitizen(MILO);
      assert.ok(result.ok);
      const after = data.snapshot();
      assert.equal(after.wallet.solLamports, before.wallet.solLamports - 450_000_000n);
      assert.ok(after.owned.includes(MILO));
      assert.equal(after.market.listings.some((item) => item.citizenId === MILO), false);
      assert.deepEqual(after.history[MILO]?.[0], { day: after.season.day, kind: 'sale', priceLamports: 450_000_000n });
      assert.equal(after.history[MILO]?.at(-1)?.kind, 'register', 'the registration stays at the start of its history');
    });

    it('brings the citizen with its scores and credits', async () => {
      const data = source();
      const before = data.snapshot();
      await data.buyCitizen(MILO);
      const after = data.snapshot();
      assert.deepEqual(
        after.citizens.find((citizen) => citizen.id === MILO),
        before.citizens.find((citizen) => citizen.id === MILO),
      );
      assert.deepEqual(after.credits[MILO], before.credits[MILO]);
    });

    it('lets the buyer train and sell it on', async () => {
      const data = source();
      await data.buyCitizen(MILO);
      assert.ok((await data.listCitizen(MILO, SOL)).ok);
    });

    it('refuses a price the wallet cannot pay, and leaves everything as it was', async () => {
      const data = source();
      assert.ok((await data.buyCitizen(MILO)).ok);
      const before = data.snapshot();
      assert.deepEqual(await data.buyCitizen(DEAREST), { ok: false, error: 'insufficient-sol' });
      assert.deepEqual(data.snapshot(), before);
    });

    it('refuses a citizen that is no longer listed and a listing of the wallet\'s own', async () => {
      const data = source();
      assert.ok((await data.buyCitizen(MILO)).ok);
      assert.deepEqual(await data.buyCitizen(MILO), { ok: false, error: 'listing-gone' }, 'a sold citizen has no listing left');
      assert.deepEqual(await data.buyCitizen(12), { ok: false, error: 'listing-gone' });
      await data.listCitizen(FARMER, SOL);
      assert.deepEqual(await data.buyCitizen(FARMER), { ok: false, error: 'own-listing' });
    });
  });

  describe('a sale of the wallet\'s citizen', () => {
    it('pays the price less the royalty, moves the citizen away and drops its mission', async () => {
      const data = source();
      const before = data.snapshot();
      assert.ok(before.missionProgress.streetLamp, 'the mock wallet is in the middle of a mission with Farmer Hale');
      assert.equal(before.missionProgress.streetLamp.citizenId, FARMER);

      await data.listCitizen(FARMER, 2n * SOL);
      const sold = await data.simulateSale?.(FARMER);
      assert.ok(sold?.ok);

      const after = data.snapshot();
      assert.equal(after.wallet.solLamports, before.wallet.solLamports + 1_900_000_000n);
      assert.equal(after.owned.includes(FARMER), false);
      assert.equal(after.missionProgress.streetLamp, undefined);
      assert.deepEqual(after.history[FARMER]?.[0], { day: after.season.day, kind: 'sale', priceLamports: 2n * SOL });
      assert.equal(after.market.listings.some((item) => item.citizenId === FARMER), false);
    });

    it('needs a listing of the wallet\'s own', async () => {
      const data = source();
      assert.deepEqual(await data.simulateSale?.(FARMER), { ok: false, error: 'not-listed' });
      assert.deepEqual(await data.simulateSale?.(MILO), { ok: false, error: 'not-listed' });
    });
  });
});

describe('auction rules', () => {
  it('takes the start price first, then 5% over the highest bid, rounded up', () => {
    assert.equal(minNextBid(SOL / 2n, null), SOL / 2n);
    assert.equal(minNextBid(SOL / 2n, 820_000_000n), 861_000_000n);
    assert.equal(minNextBid(1n, 1n), 2n, 'a bid always moves by at least one lamport');
    assert.equal(minNextBid(1n, 21n), 23n);
  });

  it('suggests the lowest bid rounded up to a thousandth of a SOL', () => {
    assert.equal(suggestedBid(949_252_500n), 950_000_000n);
    assert.equal(suggestedBid(861_000_000n), 861_000_000n);
  });

  it('moves the end of an auction only for a bid in its last ten minutes', () => {
    assert.equal(endAfterBid(10_000, 5_000), 10_000);
    assert.equal(endAfterBid(10_000, 9_700), 10_300);
  });

  it('writes the time left at the precision that matters', () => {
    assert.equal(timeLeftText(2 * 86_400 + 5 * 3_600), '2d 5h');
    assert.equal(timeLeftText(3 * 3_600 + 5 * 60), '3h 05m');
    assert.equal(timeLeftText(25 * 60), '25m');
    assert.equal(timeLeftText(4 * 60 + 7), '4m 07s');
    assert.equal(timeLeftText(-3), '0m 00s');
  });

  it('shows the auctions of a role, the one ending first at the top', () => {
    const { market, citizens } = source().snapshot();
    const ends = shownAuctions(market.auctions, citizens, 'all').map((auction) => auction.endsAt);
    assert.deepEqual(ends, [...ends].sort((a, b) => a - b));
    assert.equal(shownAuctions(market.auctions, citizens, 'pioneer').length, 0);
  });

  it('names auction lengths at their largest whole unit, on either clock', () => {
    assert.equal(clockSpan(24 * AUCTION_CLOCKS.real.hourSeconds), '24 hours');
    assert.equal(clockSpan(AUCTION_CLOCKS.real.extensionSeconds), '10 minutes');
    assert.equal(clockSpan(24 * AUCTION_CLOCKS['devnet-fast'].hourSeconds), '4 minutes');
    assert.equal(clockSpan(AUCTION_CLOCKS['devnet-fast'].extensionSeconds), '1 minute');
    assert.equal(clockSpan(AUCTION_CLOCKS['devnet-fast'].hourSeconds), '10 seconds');
    assert.equal(clockSpan(3_600), '1 hour');
    assert.equal(clockSpan(90), '90 seconds');
    assert.equal(endAfterBid(10_000, 9_970, AUCTION_CLOCKS['devnet-fast']), 10_030);
    assert.equal(endAfterBid(10_000, 9_900, AUCTION_CLOCKS['devnet-fast']), 10_000);
  });

  it('says how long ago a bid was, and that an untimed bid is new', () => {
    assert.equal(timeAgoText(1_000, 1_030), 'just now');
    assert.equal(timeAgoText(null, 1_000), 'just now');
    assert.equal(timeAgoText(1_000, 1_000 + 12 * 60 + 5), '12m ago');
    assert.equal(timeAgoText(1_000, 1_000 + 3 * 3_600), '3h ago');
    assert.equal(timeAgoText(1_000, 1_000 + 2 * 86_400 + 5), '2d ago');
    assert.equal(timeAgoText(2_000, 1_000), 'just now', 'a clock behind the chain does not go negative');
  });

  it('merges the bids of every auction, newest first, marking the one that leads each', () => {
    const auction = (citizenId: number, bids: [bigint, number | null][]): MarketAuction => ({
      citizenId,
      seller: 'Sell…er1',
      startPriceLamports: 1n,
      highestBidLamports: bids[0]?.[0] ?? null,
      bidCount: bids.length,
      bids: bids.map(([amountLamports, at]) => ({ bidder: 'Bidd…er1', amountLamports, at, mine: false })),
      endsAt: 9_000,
      minBidLamports: 1n,
      leading: false,
      deliverable: true,
    });
    const feed = bidFeed(
      [
        auction(5, [
          [30n, 300],
          [20n, 100],
        ]),
        auction(7, [
          [9n, null],
          [8n, 200],
        ]),
      ],
      10,
    );
    assert.deepEqual(
      feed.map((entry) => [entry.citizenId, entry.bid.amountLamports, entry.leading]),
      [
        [7, 9n, true],
        [5, 30n, true],
        [7, 8n, false],
        [5, 20n, false],
      ],
    );
    assert.equal(bidFeed([auction(5, [[30n, 300], [20n, 100]])], 1).length, 1);
  });

  it('remembers which notices were shown, newest first and capped', () => {
    const notice = (id: string) => ({ id, kind: 'won', citizenId: 1, priceLamports: 1n }) as const;
    const seen = markNoticesSeen(['old'], [notice('b'), notice('old'), notice('a')]);
    assert.deepEqual(seen, ['b', 'a', 'old']);
    assert.deepEqual(unseenNotices([notice('c'), notice('a')], seen).map((item) => item.id), ['c']);
    const many = Array.from({ length: 300 }, (_, index) => notice(`n${index}`));
    assert.equal(markNoticesSeen([], many).length, 200);
  });
});

describe('auctions in the preview', () => {
  const START = 1_800_000_000;
  const timed = () => {
    let seconds = START;
    const data = createMockDataSource({
      roster,
      baseTrainingCostAtoms: '100000000',
      mintPriceLamports: '10000000',
      mintLimitPerWallet: 2,
      random: () => 0,
      clock: () => seconds * 1000,
    });
    return { data, pass: (by: number) => (seconds += by) };
  };
  const auctionOf = (data: DistrictDataSource, id: number) => data.snapshot().market.auctions.find((item) => item.citizenId === id);

  it('opens with auctions of other players: one with bids, one without', () => {
    const { data } = timed();
    const { auctions } = data.snapshot().market;
    assert.equal(auctions.length, 2);
    assert.ok(auctions.some((auction) => auction.bidCount > 0 && auction.highestBidLamports !== null));
    assert.ok(auctions.some((auction) => auction.bidCount === 0 && auction.highestBidLamports === null));
    for (const auction of auctions) {
      assert.equal(auction.bids.length, auction.bidCount, 'every bid of the preview is listed');
      assert.equal(auction.bids[0]?.amountLamports ?? null, auction.highestBidLamports, 'the newest bid is the highest');
      const times = auction.bids.map((bid) => bid.at ?? 0);
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
    }
    for (const auction of auctions) assert.ok(auction.endsAt > START && !data.snapshot().owned.includes(auction.citizenId));
  });

  it('starts an auction of an owned citizen and keeps it out of the fixed-price market', async () => {
    const { data } = timed();
    assert.deepEqual(await data.auctionCitizen(FARMER, SOL, 36), { ok: false, error: 'invalid-price' });
    assert.ok((await data.auctionCitizen(FARMER, SOL, 48)).ok);
    const auction = auctionOf(data, FARMER);
    assert.equal(auction?.endsAt, START + 48 * 3_600);
    assert.equal(auction?.minBidLamports, SOL);
    assert.ok(data.snapshot().owned.includes(FARMER), 'the citizen stays in the wallet');
    assert.deepEqual(await data.listCitizen(FARMER, SOL), { ok: false, error: 'in-auction' });
    assert.deepEqual(await data.auctionCitizen(FARMER, SOL, 24), { ok: false, error: 'in-auction' });
    await data.listCitizen(2, SOL);
    assert.deepEqual(await data.auctionCitizen(2, SOL, 24), { ok: false, error: 'already-listed' });
    assert.deepEqual(await data.auctionCitizen(MILO, SOL, 24), { ok: false, error: 'not-owner' });
  });

  it('cancels only until the first bid', async () => {
    const { data } = timed();
    await data.auctionCitizen(FARMER, SOL, 24);
    assert.ok((await data.cancelAuction(FARMER)).ok);
    assert.equal(auctionOf(data, FARMER), undefined);
    await data.auctionCitizen(FARMER, SOL, 24);
    assert.ok(data.simulateBid && (await data.simulateBid(FARMER)).ok);
    assert.deepEqual(await data.cancelAuction(FARMER), { ok: false, error: 'auction-has-bids' });
  });

  it('holds the bid, pays it back when someone bids more, and says so', async () => {
    const { data } = timed();
    const [auction] = data.snapshot().market.auctions;
    assert.ok(auction);
    const id = auction.citizenId;
    const sol = data.snapshot().wallet.solLamports;
    assert.deepEqual(await data.placeBid(id, auction.minBidLamports - 1n), { ok: false, error: 'bid-too-low' });
    assert.ok((await data.placeBid(id, auction.minBidLamports)).ok);
    assert.equal(data.snapshot().wallet.solLamports, sol - auction.minBidLamports);
    assert.equal(auctionOf(data, id)?.leading, true);
    assert.deepEqual(await data.placeBid(id, SOL * 2n), { ok: false, error: 'already-highest' });

    assert.ok(data.simulateBid && (await data.simulateBid(id)).ok);
    assert.equal(data.snapshot().wallet.solLamports, sol, 'the beaten bid came back in full');
    assert.equal(auctionOf(data, id)?.leading, false);
    const [notice] = data.snapshot().market.notices;
    assert.deepEqual(notice && { kind: notice.kind, citizenId: notice.citizenId }, { kind: 'outbid', citizenId: id });
    const bids = auctionOf(data, id)?.bids ?? [];
    assert.equal(bids.length, auction.bidCount + 2);
    assert.deepEqual(
      bids.slice(0, 2).map((bid) => [bid.mine, bid.at]),
      [
        [false, START],
        [true, START],
      ],
      'the other player\'s bid on top of the wallet\'s own',
    );
    assert.equal(bids[1]?.amountLamports, auction.minBidLamports);
  });

  it('adds ten minutes for a late bid and refuses bids after the end', async () => {
    const { data, pass } = timed();
    await data.auctionCitizen(FARMER, SOL, 24);
    pass(24 * 3_600 - 120);
    assert.ok(data.simulateBid && (await data.simulateBid(FARMER)).ok);
    assert.equal(auctionOf(data, FARMER)?.endsAt, START + 24 * 3_600 - 120 + 600);
    pass(600);
    assert.ok(data.simulateBid);
    assert.deepEqual(await data.simulateBid(FARMER), { ok: false, error: 'auction-ended' });
  });

  it('finishes only after the end: the winner takes the citizen and the seller is paid', async () => {
    const { data, pass } = timed();
    const [auction] = data.snapshot().market.auctions;
    assert.ok(auction);
    const id = auction.citizenId;
    await data.placeBid(id, auction.minBidLamports);
    assert.deepEqual(await data.settleAuction(id), { ok: false, error: 'auction-live' });
    pass(auction.endsAt - START);
    assert.ok((await data.settleAuction(id)).ok);
    assert.ok(data.snapshot().owned.includes(id));
    assert.equal(auctionOf(data, id), undefined);
    assert.equal(data.snapshot().history[id]?.[0]?.kind, 'sale');

    await data.auctionCitizen(FARMER, SOL, 24);
    assert.ok(data.simulateBid && (await data.simulateBid(FARMER)).ok);
    const sol = data.snapshot().wallet.solLamports;
    pass(24 * 3_600);
    assert.ok((await data.settleAuction(FARMER)).ok);
    assert.ok(!data.snapshot().owned.includes(FARMER));
    assert.equal(data.snapshot().wallet.solLamports, sol + splitSale(SOL, ROYALTY_BPS).proceedsLamports);
  });

  it('leaves the citizen with its owner when nobody bid', async () => {
    const { data } = timed();
    await data.auctionCitizen(FARMER, SOL, 24);
    assert.ok(data.simulateAuctionEnd && (await data.simulateAuctionEnd(FARMER)).ok);
    assert.ok((await data.settleAuction(FARMER)).ok);
    assert.ok(data.snapshot().owned.includes(FARMER));
    assert.ok((await data.listCitizen(FARMER, SOL)).ok, 'the citizen moves freely again');
  });
});
