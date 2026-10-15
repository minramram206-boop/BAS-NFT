import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Keypair, Transaction } from '@solana/web3.js';
import {
  CLAIM_TTL_SECONDS,
  MissionError,
  claimReceiptAddress,
  findMission,
  type ClaimOutcome,
  type HistoryEvent,
  type StepProof,
} from '../dist/index.js';
import { DAY, PROGRAM_ID, rig, type Rig } from './fixtures.ts';

async function code(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof MissionError) return error.code;
    throw error;
  }
  return 'none';
}

const WALK: StepProof = { kind: 'goto' };

/** Plays a mission to its last step, waiting long enough between steps. */
async function play(r: Rig, missionId: string, proofs: StepProof[]): Promise<void> {
  const wallet = r.owner.publicKey.toBase58();
  for (const proof of proofs) {
    r.clock.advance(60);
    await r.service.step(wallet, r.asset, missionId, proof);
  }
}

const lampProofs: StepProof[] = [WALK, WALK, { kind: 'puzzle', order: [0, 1, 2, 3] }];

/** Marks the receipt of an issued claim as landed on chain. */
async function land(r: Rig, missionId: string): Promise<void> {
  const session = await r.store.getSession(r.asset);
  const mission = findMission(missionId)!;
  r.chain.receipts.add(`${r.asset}:${mission.chainId}:${session!.claim!.nonce}`);
}

describe('a whole mission', () => {
  it('goes from start to a confirmed claim and pays the points', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();

    const started = await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    assert.equal(started.session?.done, 0);
    assert.equal(started.season.day, 1);

    await play(r, 'streetLamp', lampProofs);
    const outcome = await r.service.claim(wallet, r.asset, 'streetLamp');
    assert.equal(outcome.status, 'sign');

    await land(r, 'streetLamp');
    const status = await r.service.confirm(wallet, r.asset, 'streetLamp');
    assert.equal(status.session, null);
    assert.deepEqual(status.doneToday, ['streetLamp']);
    assert.equal(status.points, 100);
    assert.deepEqual(status.claims, [{ missionId: 'streetLamp', stat: 'compute', day: 1 }]);
    assert.deepEqual(await r.service.standings(), [{ asset: r.asset, points: 100 }]);
  });

  it('signs a transaction for the stat chosen at start, valid for two minutes', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs);

    const issuedAt = Math.floor(r.clock.now / 1000);
    const outcome = (await r.service.claim(wallet, r.asset, 'streetLamp')) as Extract<ClaimOutcome, { status: 'sign' }>;
    assert.equal(outcome.expiresAt, issuedAt + CLAIM_TTL_SECONDS);

    const transaction = Transaction.from(Buffer.from(outcome.transaction, 'base64'));
    const data = transaction.instructions[0]!.data;
    assert.equal(data.readUInt8(8), 2, 'compute is stat index 2');
    assert.equal(data.readBigUInt64LE(9), 1n, 'streetLamp is mission 1');
    assert.equal(data.readUInt32LE(17), 1, 'season 1');
    assert.equal(data.readBigUInt64LE(21), 1_001n, 'nonce is season * 1000 + day');
    assert.equal(data.readBigInt64LE(29), BigInt(outcome.expiresAt));
    assert.equal(
      transaction.instructions[0]!.keys[5]!.pubkey.toBase58(),
      claimReceiptAddress(PROGRAM_ID, new (await import('@solana/web3.js')).PublicKey(r.asset), 1, 1_001).toBase58(),
    );
  });

  it('returns the same claim when asked again before it expires', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs);
    const first = (await r.service.claim(wallet, r.asset, 'streetLamp')) as Extract<ClaimOutcome, { status: 'sign' }>;
    r.clock.advance(30);
    const second = (await r.service.claim(wallet, r.asset, 'streetLamp')) as Extract<ClaimOutcome, { status: 'sign' }>;
    assert.equal(second.expiresAt, first.expiresAt);
  });

  it('waits out the margin after expiry, then issues a new claim', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs);
    const first = (await r.service.claim(wallet, r.asset, 'streetLamp')) as Extract<ClaimOutcome, { status: 'sign' }>;

    r.clock.advance(CLAIM_TTL_SECONDS + 5);
    assert.equal(await code(() => r.service.claim(wallet, r.asset, 'streetLamp')), 'claim-pending');

    r.clock.advance(40);
    const next = (await r.service.claim(wallet, r.asset, 'streetLamp')) as Extract<ClaimOutcome, { status: 'sign' }>;
    assert.ok(next.expiresAt > first.expiresAt);
  });

  it('counts a claim that landed after the client gave up, and never issues a second one', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs);
    await r.service.claim(wallet, r.asset, 'streetLamp');
    await land(r, 'streetLamp');
    r.clock.advance(CLAIM_TTL_SECONDS + 5);
    const outcome = await r.service.claim(wallet, r.asset, 'streetLamp');
    assert.deepEqual(outcome, { status: 'confirmed', points: 100 });
    assert.equal(await code(() => r.service.claim(wallet, r.asset, 'streetLamp')), 'no-session');
  });

  it('does not confirm a claim whose receipt is not on chain', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs);
    await r.service.claim(wallet, r.asset, 'streetLamp');
    assert.equal(await code(() => r.service.confirm(wallet, r.asset, 'streetLamp')), 'claim-missing');
  });

  it('refuses to claim before the last step and to abandon a mission that already landed', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs.slice(0, 2));
    assert.equal(await code(() => r.service.claim(wallet, r.asset, 'streetLamp')), 'steps-left');

    await play(r, 'streetLamp', lampProofs.slice(2));
    await r.service.claim(wallet, r.asset, 'streetLamp');
    await land(r, 'streetLamp');
    assert.equal(await code(() => r.service.abandon(wallet, r.asset)), 'claim-pending');
  });
});

describe('limits', () => {
  async function finish(r: Rig, missionId: string, stat: 'intelligence' | 'alignment' | 'compute', proofs: StepProof[]) {
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, missionId, stat);
    await play(r, missionId, proofs);
    await r.service.claim(wallet, r.asset, missionId);
    await land(r, missionId);
    await r.service.confirm(wallet, r.asset, missionId);
  }

  it('allows three missions a day, one of each, and starts over the next day', async () => {
    const r = rig({}, [3, 3, 3]);
    const wallet = r.owner.publicKey.toBase58();
    await finish(r, 'streetLamp', 'compute', lampProofs);
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'streetLamp', 'compute')), 'mission-cooldown');
    await finish(r, 'lightsOut', 'intelligence', [WALK, { kind: 'talk', answer: 1 }, { kind: 'talk', answer: 2 }]);
    await finish(r, 'hearthDeliveries', 'alignment', [WALK, WALK, { kind: 'talk', answer: 0 }]);
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'nightPatrol', 'compute')), 'daily-limit');

    r.clock.advance(DAY);
    const status = await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    assert.equal(status.season.day, 2);
    assert.deepEqual(status.doneToday, []);
    assert.equal(status.points, 300);
  });

  it('keeps one mission per citizen at a time, and abandoning frees the citizen', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'lightsOut', 'intelligence')), 'citizen-busy');
    await r.service.abandon(wallet, r.asset);
    await r.service.start(wallet, r.asset, 'lightsOut', 'intelligence');
  });

  it('refuses before the season starts and after it ends', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    r.clock.advance(-7_200);
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'streetLamp', 'compute')), 'season-closed');
    r.clock.advance(7_200 + 28 * DAY);
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'streetLamp', 'compute')), 'season-closed');
  });

  it('opens an event mission only in its window', async () => {
    const start = 1_800_000_000 + 3_600;
    const r = rig({ events: { blackoutNight: { startsAt: start + 1_000, endsAt: start + 2_000 } } });
    const wallet = r.owner.publicKey.toBase58();
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'blackoutNight', 'compute')), 'mission-closed');
    r.clock.advance(1_500);
    await r.service.start(wallet, r.asset, 'blackoutNight', 'compute');
  });

  it('reports the season clock with the event windows', () => {
    const window = { startsAt: 1_800_090_000, endsAt: 1_800_100_000 };
    const r = rig({ events: { blackoutNight: window } });
    assert.deepEqual(r.service.season(), {
      id: 1,
      startsAt: 1_800_000_000,
      days: 28,
      day: 1,
      open: true,
      events: { blackoutNight: window },
    });
    r.clock.advance(28 * DAY);
    assert.equal(r.service.season().day, 29);
    assert.equal(r.service.season().open, false);
  });

  it('pays event missions 150 points', async () => {
    const start = 1_800_000_000 + 3_600;
    const r = rig({ events: { blackoutNight: { startsAt: start, endsAt: start + 10 * DAY } } });
    await finish(r, 'blackoutNight', 'compute', [
      { kind: 'puzzle', order: [0, 1, 2] },
      { kind: 'talk', answer: 1 },
      { kind: 'talk', answer: 0 },
    ]);
    assert.deepEqual(await r.service.standings(), [{ asset: r.asset, points: 150 }]);
  });
});

describe('who may play', () => {
  it('refuses a wallet that does not hold the citizen', async () => {
    const r = rig();
    const stranger = Keypair.generate().publicKey.toBase58();
    assert.equal(await code(() => r.service.start(stranger, r.asset, 'streetLamp', 'compute')), 'not-owner');
    assert.equal(await code(() => r.service.status(stranger, r.asset)), 'not-owner');
  });

  it('follows the asset to its new holder', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    const buyer = Keypair.generate().publicKey.toBase58();
    r.chain.owners.set(r.asset, buyer);
    assert.equal(await code(() => r.service.step(wallet, r.asset, 'streetLamp', WALK)), 'not-owner');
  });

  it('refuses an asset that is not an official citizen, and one nobody registered', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    assert.equal(await code(() => r.service.start(wallet, Keypair.generate().publicKey.toBase58(), 'streetLamp', 'compute')), 'citizen-not-found');
    r.chain.citizens.delete(r.asset);
    assert.equal(await code(() => r.service.start(wallet, r.asset, 'streetLamp', 'compute')), 'citizen-not-found');
    assert.equal(await code(() => r.service.status(wallet, 'nope')), 'bad-request');
  });

  it('opens the watch district only for a citizen at Tier 1', async () => {
    const low = rig({}, [1, 2, 2]);
    assert.equal(await code(() => low.service.start(low.owner.publicKey.toBase58(), low.asset, 'nightPatrol', 'alignment')), 'district-locked');
    const high = rig({}, [1, 3, 2]);
    await high.service.start(high.owner.publicKey.toBase58(), high.asset, 'nightPatrol', 'alignment');
  });
});

describe('steps', () => {
  it('refuses a step reported too early, a wrong answer and a step for another mission', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'lightsOut', 'intelligence');
    assert.equal(await code(() => r.service.step(wallet, r.asset, 'lightsOut', WALK)), 'too-fast');
    r.clock.advance(60);
    await r.service.step(wallet, r.asset, 'lightsOut', WALK);
    r.clock.advance(60);
    assert.equal(await code(() => r.service.step(wallet, r.asset, 'lightsOut', { kind: 'talk', answer: 0 })), 'wrong-answer');
    assert.equal(await code(() => r.service.step(wallet, r.asset, 'streetLamp', WALK)), 'wrong-session');
    const status = await r.service.status(wallet, r.asset);
    assert.equal(status.session?.done, 1, 'a wrong answer leaves the step open for another try');
  });

  it('reports no session when none was started', async () => {
    const r = rig();
    assert.equal(await code(() => r.service.step(r.owner.publicKey.toBase58(), r.asset, 'streetLamp', WALK)), 'no-session');
  });

  it('serializes two starts for one citizen', async () => {
    const r = rig();
    const wallet = r.owner.publicKey.toBase58();
    const results = await Promise.allSettled([
      r.service.start(wallet, r.asset, 'streetLamp', 'compute'),
      r.service.start(wallet, r.asset, 'lightsOut', 'intelligence'),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  });
});

describe('public history', () => {
  async function claimLamp(r: Rig): Promise<void> {
    const wallet = r.owner.publicKey.toBase58();
    await r.service.start(wallet, r.asset, 'streetLamp', 'compute');
    await play(r, 'streetLamp', lampProofs);
    await r.service.claim(wallet, r.asset, 'streetLamp');
    await land(r, 'streetLamp');
  }

  it('hands one line to the hook when a claim is confirmed, without the stat or the owner', async () => {
    const events: HistoryEvent[] = [];
    const r = rig({ onHistory: (event) => void events.push(event) });
    await claimLamp(r);
    await r.service.confirm(r.owner.publicKey.toBase58(), r.asset, 'streetLamp');

    assert.equal(events.length, 1);
    assert.equal(events[0]!.asset, r.asset);
    assert.equal(events[0]!.eventKey, 'claim-1-1-streetLamp');
    assert.equal(events[0]!.line, 'Finished the "street lamp" mission in the forge district on day 1 of season 1.');
    assert.ok(!/compute|intelligence|alignment/i.test(events[0]!.line));
    assert.ok(!events[0]!.line.includes(r.owner.publicKey.toBase58()));
  });

  it('still counts the claim when the hook throws', async () => {
    const r = rig({
      onHistory: () => {
        throw new Error('queue is down');
      },
    });
    await claimLamp(r);
    const status = await r.service.confirm(r.owner.publicKey.toBase58(), r.asset, 'streetLamp');
    assert.deepEqual(status.doneToday, ['streetLamp']);
    assert.equal(status.points, 100);
  });

  it('labels a district event task as such', async () => {
    const events: HistoryEvent[] = [];
    const r = rig({ onHistory: (event) => void events.push(event) });
    const mission = findMission('blackoutNight')!;
    const line = (await import('../dist/index.js')).describeClaim(
      { asset: r.asset, missionId: mission.id, stat: 'compute', seasonId: 1, day: 5, points: 20, confirmedAt: 0 },
      mission,
    );
    assert.match(line.line, /district event task/);
    assert.match(line.line, /"blackout night"/);
  });
});
