import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { buildPrizeTree, toHex, type PrizeRow } from '@bas/chain-client';
import type { Address } from '@solana/kit';
import { Authenticator, PrizeBook, createMissionServer, readPublishedPrizes, seasonFrom } from '../dist/index.js';
import { rig } from './fixtures.ts';

async function publish(dir: string, seasonId: number, rows: PrizeRow[], root?: string): Promise<void> {
  const tree = await buildPrizeTree(seasonId, rows);
  const file = {
    seasonId,
    root: root ?? toHex(tree.root),
    fundedLamports: '10000000000',
    prizesLamports: rows.reduce((sum, row) => sum + row.amountLamports, 0n).toString(),
    signature: null,
    publishedAt: 1,
    rows: rows.map((row) => ({ ...row, amountLamports: row.amountLamports.toString() })),
  };
  writeFileSync(join(dir, `season-${seasonId}.json`), JSON.stringify(file));
}

const winner = (): Address => Keypair.generate().publicKey.toBase58() as Address;
const rows = (): PrizeRow[] => [
  { index: 0, winner: winner(), amountLamports: 1_500_000_000n, asset: 'asset-a', pool: 'open', rank: 1 },
  { index: 1, winner: winner(), amountLamports: 900_000_000n, asset: 'asset-b', pool: 'open', rank: 2 },
];

describe('published prizes', () => {
  it('reads a list whose rows hash to its root, and refuses one that does not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prizes-'));
    assert.equal(await readPublishedPrizes(dir, 1), null);
    const list = rows();
    await publish(dir, 1, list);
    const read = await readPublishedPrizes(dir, 1);
    assert.equal(read?.rows.length, 2);
    assert.equal(read?.rows[0]?.winner, list[0]?.winner);

    await publish(dir, 2, rows(), 'ab'.repeat(32));
    await assert.rejects(readPublishedPrizes(dir, 2), /do not hash to its root/);
    writeFileSync(join(dir, 'season-3.json'), JSON.stringify({ seasonId: 3, rows: [] }));
    await assert.rejects(readPublishedPrizes(dir, 3), /not a published winners list/);
  });

  it('serves the current season, or the one asked for, without a token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prizes-'));
    await publish(dir, 1, rows());
    const server = createMissionServer({
      service: rig().service,
      auth: new Authenticator(Buffer.alloc(32, 5)),
      allowedOrigins: [],
      prizes: new PrizeBook(dir),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const current = (await (await fetch(`${base}/season/prizes`)).json()) as { prizes: { seasonId: number; rows: unknown[] } };
      assert.equal(current.prizes.seasonId, 1);
      assert.equal(current.prizes.rows.length, 2);
      const other = (await (await fetch(`${base}/season/prizes?season=4`)).json()) as { prizes: null };
      assert.equal(other.prizes, null);
      assert.equal((await fetch(`${base}/season/prizes?season=zero`)).status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('season clock', () => {
  const env = { SEASON_STARTS_AT: '1000' };

  it('runs a real day unless devnet asks for a shorter one', () => {
    assert.deepEqual(seasonFrom(env, 'mainnet-beta'), { id: 1, startsAt: 1000, days: 28 });
    assert.deepEqual(seasonFrom({ ...env, SEASON_DAY_SECONDS: '600', SEASON_DAYS: '3' }, 'devnet'), {
      id: 1,
      startsAt: 1000,
      days: 3,
      daySeconds: 600,
    });
    assert.throws(() => seasonFrom({ ...env, SEASON_DAY_SECONDS: '600' }, 'mainnet-beta'), /only be shortened on devnet/);
    assert.throws(() => seasonFrom({ ...env, SEASON_DAY_SECONDS: '10' }, 'devnet'), /at least 60/);
  });

  it('counts days and the end on the short clock', () => {
    const r = rig({ season: { id: 2, startsAt: 1_000, days: 3, daySeconds: 600 }, clock: () => (1_000 + 1_250) * 1000 });
    const info = r.service.season();
    assert.equal(info.day, 3);
    assert.equal(info.daySeconds, 600);
    assert.equal(info.endsAt, 1_000 + 1_800);
  });
});
