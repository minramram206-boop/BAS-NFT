import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PgMemoryStore, PgQuotaStore, PgSpendLedger, createPool, migrate } from '../dist/index.js';

const url = process.env.BAS_TEST_DATABASE_URL;
const skip = url ? false : 'set BAS_TEST_DATABASE_URL to run the Postgres tests';

const ASSET = 'Asset1111111111111111111111111111111111111';
const OWNER = 'Owner1111111111111111111111111111111111111';
const BUYER = 'Buyer1111111111111111111111111111111111111';

describe('postgres stores', { skip }, () => {
  const pool = createPool(url ?? 'postgres://unused');

  before(async () => {
    await pool.query('DROP TABLE IF EXISTS chat_quota, chat_spend, chat_private_memory, chat_public_memory, market_sales, market_bids, market_cursor, market_seen, chat_migrations');
    await migrate(pool);
  });
  after(() => pool.end());

  it('applies each migration once', async () => {
    assert.deepEqual(await migrate(pool), []);
    const [first, second] = await Promise.all([migrate(pool), migrate(pool)]);
    assert.deepEqual([first, second], [[], []]);
  });

  it('hands out exactly the daily limit when many requests arrive together', async () => {
    const quota = new PgQuotaStore(pool);
    const results = await Promise.all(Array.from({ length: 50 }, () => quota.consume(ASSET, '2026-10-14', 20)));
    assert.equal(results.filter((result) => result.allowed).length, 20);
    assert.equal(await quota.used(ASSET, '2026-10-14'), 20);
    assert.deepEqual(await quota.consume(ASSET, '2026-10-14', 20), { allowed: false, used: 20 });
  });

  it('counts per asset and per day, and gives a message back on refund', async () => {
    const quota = new PgQuotaStore(pool);
    assert.deepEqual(await quota.consume(BUYER, '2026-10-14', 2), { allowed: true, used: 1 });
    assert.deepEqual(await quota.consume(BUYER, '2026-10-15', 2), { allowed: true, used: 1 });
    await quota.refund(BUYER, '2026-10-14');
    assert.equal(await quota.used(BUYER, '2026-10-14'), 0);
    await quota.refund(BUYER, '2026-10-14');
    assert.equal(await quota.used(BUYER, '2026-10-14'), 0);
    assert.deepEqual(await quota.consume(BUYER, '2026-10-16', 0), { allowed: false, used: 0 });
  });

  it('never lets reservations pass the cap, however many arrive at once', async () => {
    const ledger = new PgSpendLedger(pool);
    const results = await Promise.all(Array.from({ length: 30 }, () => ledger.reserve('2026-10-14', 100, 1_000)));
    assert.equal(results.filter(Boolean).length, 10);
    assert.equal(await ledger.spentMicroUsd('2026-10-14'), 1_000);
    assert.equal(await ledger.reserve('2026-10-14', 1, 1_000), false);
    assert.equal(await ledger.reserve('2026-10-20', 2_000, 1_000), false);
  });

  it('corrects a reservation to the real cost and never goes below zero', async () => {
    const ledger = new PgSpendLedger(pool);
    await ledger.reserve('2026-10-21', 500, 10_000);
    await ledger.adjust('2026-10-21', -380);
    assert.equal(await ledger.spentMicroUsd('2026-10-21'), 120);
    await ledger.adjust('2026-10-21', -1_000);
    assert.equal(await ledger.spentMicroUsd('2026-10-21'), 0);
    await ledger.adjust('2026-10-22', 75);
    assert.equal(await ledger.spentMicroUsd('2026-10-22'), 75);
  });

  it('keeps private memory per owner and public history per asset', async () => {
    const memory = new PgMemoryStore(pool);
    await memory.savePrivateMemory(ASSET, OWNER, { nickname: 'Boss', summary: 'Likes lamps.', updatedAt: 5 });
    assert.deepEqual(await memory.privateMemory(ASSET, OWNER), { nickname: 'Boss', summary: 'Likes lamps.', updatedAt: 5 });
    assert.equal(await memory.privateMemory(ASSET, BUYER), null);

    assert.equal(await memory.addPublicLine(ASSET, 'mission:1', 'Fixed the street lamp.', 10), true);
    assert.equal(await memory.addPublicLine(ASSET, 'mission:1', 'Fixed the street lamp.', 11), false);
    assert.deepEqual(await memory.publicHistory(ASSET), ['Fixed the street lamp.']);

    await memory.deletePrivateMemory(ASSET, OWNER);
    assert.equal(await memory.privateMemory(ASSET, OWNER), null);
    assert.deepEqual(await memory.publicHistory(ASSET), ['Fixed the street lamp.']);
  });

  it('sends only the latest twenty public lines, oldest first', async () => {
    const memory = new PgMemoryStore(pool);
    const asset = 'Busy11111111111111111111111111111111111111';
    for (let i = 1; i <= 25; i += 1) await memory.addPublicLine(asset, `event:${i}`, `Line ${i}`, i);
    const lines = await memory.publicHistory(asset);
    assert.equal(lines.length, 20);
    assert.equal(lines[0], 'Line 6');
    assert.equal(lines[19], 'Line 25');
  });

  it('replaces a summary only if the record has not moved on', async () => {
    const memory = new PgMemoryStore(pool);
    await memory.savePrivateMemory(ASSET, BUYER, { nickname: null, summary: 'Long notes.', updatedAt: 100 });
    assert.equal(await memory.replaceSummary(ASSET, BUYER, 99, 'Stale rewrite.', 200), false);
    assert.equal(await memory.replaceSummary(ASSET, BUYER, 100, 'Short notes.', 200), true);
    assert.deepEqual(await memory.privateMemory(ASSET, BUYER), { nickname: null, summary: 'Short notes.', updatedAt: 200 });
    assert.equal(await memory.replaceSummary(ASSET, BUYER, 100, 'Again.', 300), false);
  });
});
