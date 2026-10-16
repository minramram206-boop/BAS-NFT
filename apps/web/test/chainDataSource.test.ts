import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { AUCTION_CLOCKS, type AuctionClock } from '@bas/chain-client/browser';
import { loadCitizens } from '@bas/content/server';
import { Authenticator, MemoryStore, MintService, MissionService, createMissionServer, findMission } from '@bas/mission-server';
import { Keypair } from '@solana/web3.js';

import { createChainDataSource } from '../src/lib/data/chain/chainDataSource.ts';
import { createTransactions } from '../src/lib/data/chain/transactions.ts';
import type { ChainDataSource } from '../src/lib/data/chain/types.ts';
import { MISSION_CATALOG } from '../src/lib/data/missionCatalog.ts';
import { MOCK_ANSWERS } from '../src/lib/data/mock/mockSnapshot.ts';
import type { DistrictActionResult, MissionDefinition, StepProof } from '../src/lib/data/types.ts';
import {
  BASE_COST,
  COLLECTION,
  DAY,
  MARKET_AUTHORITY,
  MARKET_ID,
  PROGRAM_ID,
  SEASON_START,
  TREASURY,
  UTILITY_MINT,
  World,
  testWallet,
  type FakeSale,
  type TestWallet,
} from './chainWorld.ts';

const roster = loadCitizens();
const [A, B, C] = roster.map((citizen) => citizen.id) as [number, number, number];

class Clock {
  now = (SEASON_START + 3_600) * 1000;
  readonly read = (): number => this.now;
  advance(seconds: number): void {
    this.now += seconds * 1000;
  }
}

interface Rig {
  clock: Clock;
  world: World;
  source: ChainDataSource;
  owner: TestWallet;
  /** Holds citizen B. */
  stranger: TestWallet;
  asset: { a: string; b: string; c: string };
  network: { serverDown: boolean };
  close: () => Promise<void>;
}

const mission = (id: string): MissionDefinition => {
  const found = MISSION_CATALOG.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
};

interface RigOptions {
  events?: Record<string, { startsAt: number; endsAt: number }>;
  scores?: [number, number, number];
  /** Open a public sale holding the roster citizens that are not minted yet. */
  sale?: Partial<FakeSale>;
  /** Set the market program up, open or paused. */
  market?: 'open' | 'paused';
  /** The market program runs this auction clock, and the manifest says so. */
  auctionClock?: AuctionClock;
}

async function rig(options: RigOptions = {}): Promise<Rig> {
  const clock = new Clock();
  const world = new World(roster, () => Math.floor(clock.now / 1000), options.auctionClock);
  const owner = testWallet();
  const stranger = testWallet();
  const asset = {
    a: world.add(A, owner.address, options.scores ?? [1, 1, 1], [1, 1, 2]),
    b: world.add(B, stranger.address, [2, 2, 2], [0, 0, 0]),
    // Minted but not registered yet: it exists, with no scores of its own.
    c: world.add(C, owner.address, [0, 0, 0], [0, 0, 0], false),
  };
  world.tokens.set(owner.address, 2_000_000_000n);
  world.sol.set(owner.address, 3_000_000_000n);
  if (options.market) world.openMarket(options.market === 'paused');
  if (options.sale) {
    const queue = roster.map((citizen) => citizen.id).filter((id) => ![A, B, C].includes(id));
    world.sale_ = { queue, total: queue.length, price: 10_000_000n, limit: 1, minted: new Map(), loaded: true, ...options.sale };
  }

  const service = new MissionService({
    programId: PROGRAM_ID,
    authority: Keypair.generate(),
    season: { id: 1, startsAt: SEASON_START, days: 28 },
    ...(options.events ? { events: options.events } : {}),
    store: new MemoryStore(),
    chain: world,
    clock: clock.read,
  });
  const server = createMissionServer({
    service,
    mint: new MintService({ backend: world.mintBackend(), limitPerWallet: 1 }),
    auth: new Authenticator(Buffer.alloc(32, 9)),
    allowedOrigins: [],
    rateLimit: 100_000,
    market: { activity: () => world.marketActivity() },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const network = { serverDown: false };

  const source = createChainDataSource({
    roster,
    reads: world,
    transactions: createTransactions({
      rpc: world.sendRpc(),
      programId: PROGRAM_ID.toBase58(),
      utilityMint: UTILITY_MINT,
      market: { programId: MARKET_ID, collection: COLLECTION },
      sleep: async () => {},
    }),
    missionApi: {
      baseUrl,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        if (network.serverDown) throw new TypeError('fetch failed');
        return fetch(...args);
      }) as typeof fetch,
    },
    baseTrainingCostAtoms: BASE_COST.toString(),
    mintPriceLamports: '10000000',
    mintLimitPerWallet: 1,
    maxSupply: 100,
    ...(options.auctionClock ? { auctionClock: options.auctionClock } : {}),
    clock: clock.read,
    sleep: async () => {},
  });
  return {
    clock,
    world,
    source,
    owner,
    stranger,
    asset,
    network,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function ok(result: DistrictActionResult) {
  assert.ok(result.ok, result.ok ? '' : `refused with ${result.error}`);
  return result.snapshot;
}

function refused(result: DistrictActionResult): string {
  assert.equal(result.ok, false, 'expected a refusal');
  return result.ok ? '' : result.error;
}

/** The proof a player would give for step `index` of a mission. */
function proofFor(missionId: string, index: number): StepProof {
  const step = findMission(missionId)!.steps[index]!;
  if (step.kind === 'goto') return { kind: 'goto' };
  if (step.kind === 'talk') return { kind: 'talk', answer: MOCK_ANSWERS[missionId]![index]! };
  return { kind: 'puzzle', order: Array.from({ length: step.pieces }, (_, position) => position) };
}

/** Plays steps `from` up to (not including) `to` of a mission, leaving the walk time the server asks for. */
async function playSteps(r: Rig, citizenId: number, missionId: string, from: number, to: number): Promise<DistrictActionResult> {
  let last: DistrictActionResult = { ok: true, snapshot: r.source.snapshot() };
  for (let index = from; index < to; index += 1) {
    r.clock.advance(20);
    last = await r.source.advanceMission(citizenId, missionId, proofFor(missionId, index));
    if (!last.ok) return last;
  }
  return last;
}

async function playAll(r: Rig, citizenId: number, missionId: string): Promise<DistrictActionResult> {
  return playSteps(r, citizenId, missionId, 0, findMission(missionId)!.steps.length);
}

describe('reading the district', () => {
  let r: Rig;
  before(async () => {
    r = await rig();
  });
  after(() => r.close());

  it('starts empty and not connected', () => {
    const snapshot = r.source.snapshot();
    assert.equal(r.source.mode, 'chain');
    assert.equal(snapshot.wallet.connected, false);
    assert.deepEqual(snapshot.owned, []);
    assert.deepEqual(snapshot.citizens, []);
  });

  it('shows the citizens on chain with their own scores and credits once a wallet is connected', async () => {
    const snapshot = ok(await r.source.setWallet(r.owner));
    assert.equal(snapshot.wallet.connected, true);
    assert.equal(snapshot.wallet.label, `${r.owner.address.slice(0, 4)}…${r.owner.address.slice(-3)}`);
    assert.equal(snapshot.wallet.tokenAtoms, 2_000_000_000n);
    assert.equal(snapshot.wallet.solLamports, 3_000_000_000n);
    assert.deepEqual(snapshot.citizens.map((citizen) => citizen.id), [A, B, C].sort((x, y) => x - y));
    assert.deepEqual([...snapshot.owned].sort((x, y) => x - y), [A, C].sort((x, y) => x - y));

    const first = snapshot.citizens.find((citizen) => citizen.id === A)!;
    assert.deepEqual([first.intelligence, first.alignment, first.compute, first.registered], [1, 1, 1, true]);
    assert.equal(first.name, roster.find((citizen) => citizen.id === A)!.name);
    assert.deepEqual(snapshot.credits[A], { intelligence: 1, alignment: 1, compute: 2 });

    const waiting = snapshot.citizens.find((citizen) => citizen.id === C)!;
    assert.equal(waiting.registered, false);
    assert.deepEqual(snapshot.credits[C], { intelligence: 0, alignment: 0, compute: 0 });
  });

  it('reports the mint, the season and the missions that can be listed', () => {
    const snapshot = r.source.snapshot();
    assert.equal(snapshot.mint.minted, 3);
    assert.equal(snapshot.mint.maxSupply, 100);
    assert.equal(snapshot.mint.priceLamports, 10_000_000n);
    assert.equal(snapshot.mint.limitPerWallet, 1);
    assert.deepEqual(snapshot.founding, []);
    assert.deepEqual([snapshot.season.number, snapshot.season.day, snapshot.season.length], [1, 1, 28]);
    // The event is not scheduled, so it is not listed.
    assert.deepEqual(
      snapshot.missions.map((item) => item.id),
      MISSION_CATALOG.filter((item) => !item.event).map((item) => item.id),
    );
  });

  it('keeps the market closed until its program exists on the cluster', async () => {
    const { market } = r.source.snapshot();
    assert.equal(market.open, false);
    assert.deepEqual(market.listings, []);
    assert.equal(refused(await r.source.listCitizen(A, 1_000_000_000n)), 'market-closed');
    assert.equal(refused(await r.source.changeListingPrice(A, 1_000_000_000n)), 'market-closed');
    assert.equal(refused(await r.source.cancelListing(A)), 'market-closed');
    assert.equal(refused(await r.source.buyCitizen(B)), 'market-closed');
  });

  it('forgets the citizens of a wallet that disconnects', async () => {
    const snapshot = ok(await r.source.setWallet(null));
    assert.equal(snapshot.wallet.connected, false);
    assert.deepEqual(snapshot.owned, []);
    assert.equal(snapshot.wallet.tokenAtoms, 0n);
    assert.equal(snapshot.citizens.length, 3);
    ok(await r.source.setWallet(r.owner));
  });

  it('follows a citizen that is sold to another wallet', async () => {
    r.world.transfer(r.asset.a, testWallet().address);
    const snapshot = ok(await r.source.refresh!());
    assert.deepEqual(snapshot.owned, [C]);
    r.world.transfer(r.asset.a, r.owner.address);
    ok(await r.source.refresh!());
  });

  it('keeps what it knew when the cluster cannot be reached', async () => {
    r.world.down = true;
    assert.equal(refused(await r.source.refresh!()), 'unavailable');
    assert.equal(r.source.snapshot().citizens.length, 3);
    r.world.down = false;
  });
});

describe('training', () => {
  it('sends upgrade_score, burns the cost and shows the new score and credit', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      const snapshot = ok(await r.source.upgradeScore(A, 'compute'));
      assert.equal(snapshot.citizens.find((citizen) => citizen.id === A)!.compute, 2);
      assert.equal(snapshot.credits[A]!.compute, 1);
      assert.equal(snapshot.wallet.tokenAtoms, 2_000_000_000n - BASE_COST * 2n, 'the cost of raising a score of 1');
      assert.equal(r.owner.prompts.transaction, 1);
      assert.equal(r.world.applied.length, 1);
    } finally {
      await r.close();
    }
  });

  it('refuses before the wallet is asked when a rule is already broken', async () => {
    const r = await rig({ scores: [10, 1, 1] });
    try {
      assert.equal(refused(await r.source.upgradeScore(A, 'compute')), 'not-connected');
      ok(await r.source.setWallet(r.owner));
      assert.equal(refused(await r.source.upgradeScore(B, 'compute')), 'not-owner', 'held by another wallet');
      assert.equal(refused(await r.source.upgradeScore(999, 'compute')), 'not-owner', 'not on chain');
      assert.equal(refused(await r.source.upgradeScore(A, 'intelligence')), 'stat-at-max');

      r.world.find(r.asset.a).credits[2] = 0;
      ok(await r.source.refresh!());
      assert.equal(refused(await r.source.upgradeScore(A, 'compute')), 'no-credit');

      r.world.find(r.asset.a).credits[2] = 1;
      r.world.tokens.set(r.owner.address, BASE_COST);
      ok(await r.source.refresh!());
      assert.equal(refused(await r.source.upgradeScore(A, 'compute')), 'insufficient-balance');
      assert.equal(r.owner.prompts.transaction, 0, 'the wallet was never asked');
    } finally {
      await r.close();
    }
  });

  it('changes nothing when the person closes the wallet request', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      r.owner.decline = true;
      assert.equal(refused(await r.source.upgradeScore(A, 'compute')), 'declined');
      assert.equal(r.world.applied.length, 0);
      assert.equal(r.source.snapshot().citizens.find((citizen) => citizen.id === A)!.compute, 1);
    } finally {
      await r.close();
    }
  });

  it('reports a rejected transaction and reads the cluster again', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      // The tokens leave the wallet between the page's last read and the send.
      r.world.tokens.set(r.owner.address, 0n);
      const state = r.source.snapshot();
      assert.equal(state.wallet.tokenAtoms, 2_000_000_000n);
      assert.equal(refused(await r.source.upgradeScore(A, 'compute')), 'transaction-failed');
      assert.equal(r.source.snapshot().wallet.tokenAtoms, 0n, 'the balance was read again');
    } finally {
      await r.close();
    }
  });
});

describe('missions', () => {
  it('plays a mission to the end, claims the credit on chain and counts it', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      assert.equal(r.owner.prompts.message, 1, 'one sign-in at connect');

      const started = ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      assert.deepEqual(started.missionProgress.streetLamp, { citizenId: A, done: 0, stat: 'compute' });

      const midway = ok(await playSteps(r, A, 'streetLamp', 0, 2));
      assert.equal(midway.missionProgress.streetLamp!.done, 2);
      assert.equal(r.owner.prompts.transaction, 0, 'nothing to sign until the last step');

      const done = ok(await playSteps(r, A, 'streetLamp', 2, 3));
      assert.equal(done.missionProgress.streetLamp, undefined);
      assert.equal(done.credits[A]!.compute, 3, 'the claim landed on chain');
      assert.deepEqual(done.history[A]![0], { day: 1, kind: 'mission', missionId: 'streetLamp', stat: 'compute' });
      assert.equal(r.owner.prompts.transaction, 1);
      assert.equal(r.owner.prompts.message, 1, 'the token was reused');
      assert.deepEqual(done.season.leaderboards.open, [{ citizenId: A, serial: roster.find((c) => c.id === A)!.code, roleKey: roster.find((c) => c.id === A)!.roleKey, points: 100 }]);
    } finally {
      await r.close();
    }
  });

  it('leaves the step open and tells the player when the answer is wrong', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'lightsOut', 'intelligence'));
      ok(await playSteps(r, A, 'lightsOut', 0, 1));

      r.clock.advance(20);
      assert.equal(refused(await r.source.advanceMission(A, 'lightsOut', { kind: 'talk', answer: 0 })), 'wrong-answer');
      assert.equal(r.source.snapshot().missionProgress.lightsOut!.done, 1);

      ok(await playSteps(r, A, 'lightsOut', 1, 3));
      assert.equal(r.source.snapshot().missionProgress.lightsOut, undefined);
    } finally {
      await r.close();
    }
  });

  it('rejects a puzzle in the wrong order and a proof of the wrong kind', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      ok(await playSteps(r, A, 'streetLamp', 0, 2));
      r.clock.advance(20);
      assert.equal(refused(await r.source.advanceMission(A, 'streetLamp', { kind: 'puzzle', order: [1, 0, 2, 3] })), 'wrong-order');
      assert.equal(refused(await r.source.advanceMission(A, 'streetLamp', { kind: 'goto' })), 'mission-closed');
    } finally {
      await r.close();
    }
  });

  it('keeps the last step open when the person closes the claim request, and claims without a new step', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      ok(await playSteps(r, A, 'streetLamp', 0, 2));

      r.owner.decline = true;
      r.clock.advance(20);
      assert.equal(refused(await r.source.advanceMission(A, 'streetLamp', proofFor('streetLamp', 2))), 'declined');
      assert.equal(r.source.snapshot().missionProgress.streetLamp!.done, 2, 'the puzzle is still the open step');
      assert.equal(r.source.snapshot().credits[A]!.compute, 2);

      r.owner.decline = false;
      const done = ok(await r.source.advanceMission(A, 'streetLamp', proofFor('streetLamp', 2)));
      assert.equal(done.missionProgress.streetLamp, undefined);
      assert.equal(done.credits[A]!.compute, 3);
    } finally {
      await r.close();
    }
  });

  it('picks the claim up again after a reload', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      ok(await playSteps(r, A, 'streetLamp', 0, 2));
      r.owner.decline = true;
      r.clock.advance(20);
      refused(await r.source.advanceMission(A, 'streetLamp', proofFor('streetLamp', 2)));
      r.owner.decline = false;

      // A fresh page: the server still has the session, the new source reads it back.
      ok(await r.source.setWallet(r.owner));
      assert.equal(r.source.snapshot().missionProgress.streetLamp!.done, 2);
      const done = ok(await r.source.advanceMission(A, 'streetLamp', proofFor('streetLamp', 2)));
      assert.equal(done.credits[A]!.compute, 3);
    } finally {
      await r.close();
    }
  });

  it('refuses the same mission twice in one day and a fourth mission', async () => {
    const r = await rig({ scores: [1, 1, 3] });
    try {
      ok(await r.source.setWallet(r.owner));
      for (const [id, stat] of [
        ['streetLamp', 'compute'],
        ['lightsOut', 'intelligence'],
        ['hearthDeliveries', 'alignment'],
      ] as const) {
        ok(await r.source.startMission(A, id, stat));
        ok(await playAll(r, A, id));
      }
      assert.equal(r.source.snapshot().history[A]!.length, 3);
      assert.equal(refused(await r.source.startMission(A, 'streetLamp', 'compute')), 'mission-cooldown');
      assert.equal(refused(await r.source.startMission(A, 'nightPatrol', 'compute')), 'daily-limit');

      r.clock.advance(DAY);
      ok(await r.source.refresh!());
      assert.equal(r.source.snapshot().season.day, 2);
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
    } finally {
      await r.close();
    }
  });

  it('asks the server for the rules it cannot check itself', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      assert.equal(refused(await r.source.startMission(A, 'nightPatrol', 'compute')), 'district-locked');
      assert.equal(refused(await r.source.startMission(B, 'streetLamp', 'compute')), 'not-owner');
      assert.equal(refused(await r.source.startMission(A, 'streetLamp', 'intelligence')), 'invalid-stat');

      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      assert.equal(refused(await r.source.startMission(A, 'lightsOut', 'intelligence')), 'citizen-busy');
    } finally {
      await r.close();
    }
  });

  it('refuses the claim once the season is over', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      ok(await playSteps(r, A, 'streetLamp', 0, 2));
      r.clock.advance(28 * DAY);
      assert.equal(refused(await r.source.advanceMission(A, 'streetLamp', proofFor('streetLamp', 2))), 'season-closed');
      assert.equal(r.owner.prompts.transaction, 0);
      assert.equal(refused(await r.source.startMission(B, 'streetLamp', 'compute')), 'not-owner');
    } finally {
      await r.close();
    }
  });

  it('abandons a mission', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      const snapshot = ok(await r.source.abandonMission('streetLamp'));
      assert.deepEqual(snapshot.missionProgress, {});
      ok(await r.source.startMission(A, 'lightsOut', 'intelligence'));
      assert.equal(refused(await r.source.abandonMission('streetLamp')), 'mission-closed');
    } finally {
      await r.close();
    }
  });

  it('asks again for the sign-in when the person closed it at connect', async () => {
    const r = await rig();
    try {
      r.owner.declineMessages = true;
      const snapshot = ok(await r.source.setWallet(r.owner));
      assert.deepEqual(snapshot.missionProgress, {}, 'no mission data without a sign-in');
      ok(await r.source.refresh!());
      assert.equal(r.owner.prompts.message, 1, 'a refresh does not ask again on its own');

      assert.equal(refused(await r.source.startMission(A, 'streetLamp', 'compute')), 'declined');
      assert.equal(r.owner.prompts.message, 2);
      r.owner.declineMessages = false;
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      assert.equal(r.owner.prompts.message, 3);
    } finally {
      await r.close();
    }
  });

  it('says so when the mission server is down and keeps the district on screen', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      r.network.serverDown = true;
      assert.equal(refused(await r.source.startMission(A, 'streetLamp', 'compute')), 'unavailable');
      const snapshot = ok(await r.source.refresh!());
      assert.equal(snapshot.citizens.length, 3, 'the cluster part still loads');
      assert.equal(snapshot.season.length, 28, 'the last known season stays');
      r.network.serverDown = false;
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
    } finally {
      await r.close();
    }
  });

  it('cannot mint from here yet', async () => {
    const r = await rig();
    try {
      ok(await r.source.setWallet(r.owner));
      assert.equal(refused(await r.source.mintCitizen()), 'unavailable');
    } finally {
      await r.close();
    }
  });
});

describe('district events', () => {
  it('lists an event that is coming, lets it start inside its window and hides it once it is over', async () => {
    const start = SEASON_START + 3_600;
    const r = await rig({ events: { blackoutNight: { startsAt: start + 2 * DAY, endsAt: start + 3 * DAY } } });
    try {
      ok(await r.source.setWallet(r.owner));
      const event = () => r.source.snapshot().missions.find((item) => item.id === 'blackoutNight');
      assert.equal(event()!.opensInHours, 48);
      assert.equal(refused(await r.source.startMission(A, 'blackoutNight', 'compute')), 'mission-closed');

      r.clock.advance(2 * DAY + 60);
      ok(await r.source.refresh!());
      assert.equal(event()!.opensInHours, undefined);
      assert.equal(event()!.event, true);
      ok(await r.source.startMission(A, 'blackoutNight', 'compute'));
      ok(await playAll(r, A, 'blackoutNight'));
      assert.equal(r.source.snapshot().season.leaderboards.open![0]!.points, 150);

      r.clock.advance(2 * DAY);
      ok(await r.source.refresh!());
      assert.equal(event(), undefined);
    } finally {
      await r.close();
    }
  });
});

describe('season standings', () => {
  it('ranks citizens by points and files each one under its bracket', async () => {
    const r = await rig({ scores: [1, 1, 5] });
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.startMission(A, 'streetLamp', 'compute'));
      ok(await playAll(r, A, 'streetLamp'));
      const { pools, leaderboards } = r.source.snapshot().season;
      assert.equal(leaderboards.skilled?.[0]?.citizenId, A, 'a highest stat of 5 is the skilled bracket');
      assert.equal(leaderboards.rookie, undefined);
      assert.equal(pools.find((pool) => pool.id === 'skilled')!.validEntries, 1);
      assert.equal(pools.find((pool) => pool.id === 'open')!.validEntries, 1);
      assert.equal(pools.find((pool) => pool.id === 'master')!.validEntries, 0);
    } finally {
      await r.close();
    }
  });
});

describe('minting', () => {
  /** A wallet with SOL and no citizen, connected to a rig that has a sale. */
  async function buyerRig(sale: RigOptions['sale'] = {}, sol = 1_000_000_000n) {
    const r = await rig({ sale });
    const buyer = testWallet();
    r.world.sol.set(buyer.address, sol);
    return { r, buyer };
  }

  it('reads the real supply from the Candy Machine instead of the manifest', async () => {
    const { r, buyer } = await buyerRig();
    try {
      const snapshot = ok(await r.source.setWallet(buyer));
      assert.equal(snapshot.mint.maxSupply, 7, 'the machine holds 7 citizens, not the 100 of the manifest');
      assert.equal(snapshot.mint.minted, 0, 'minted comes from the machine, not from counting what the page can see');
      assert.equal(snapshot.mint.mintedByWallet, 0);
    } finally {
      await r.close();
    }
  });

  it('pays, mints and registers in one signature, then shows the citizen it drew', async () => {
    const { r, buyer } = await buyerRig();
    try {
      ok(await r.source.setWallet(buyer));
      const next = r.world.sale_!.queue[0]!;
      const result = await r.source.mintCitizen();
      assert.ok(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return;
      assert.equal(result.citizenId, next, 'the citizen is the one the machine drew');
      assert.deepEqual(result.snapshot.owned, [next]);
      const citizen = result.snapshot.citizens.find((item) => item.id === next)!;
      assert.equal(citizen.registered, true, 'registered by the same transaction');
      assert.equal(result.snapshot.wallet.solLamports, 1_000_000_000n - 10_000_000n);
      assert.equal(result.snapshot.mint.minted, 1);
      assert.equal(result.snapshot.mint.mintedByWallet, 1);
      assert.equal(buyer.prompts.transaction, 1, 'one transaction to approve');
      assert.equal(r.world.built.length, 1);
    } finally {
      await r.close();
    }
  });

  it('stops a second mint from the same wallet before the wallet is asked', async () => {
    const { r, buyer } = await buyerRig();
    try {
      ok(await r.source.setWallet(buyer));
      assert.ok((await r.source.mintCitizen()).ok);
      assert.equal(refused(await r.source.mintCitizen()), 'mint-limit');
      assert.equal(buyer.prompts.transaction, 1);
      assert.equal(r.world.built.length, 1, 'the server was not asked for another transaction');
    } finally {
      await r.close();
    }
  });

  it('refuses a sold-out sale, a wallet without SOL and a visitor without a wallet', async () => {
    const soldOut = await buyerRig({ queue: [], total: 7 });
    try {
      ok(await soldOut.r.source.setWallet(soldOut.buyer));
      assert.equal(refused(await soldOut.r.source.mintCitizen()), 'sold-out');
    } finally {
      await soldOut.r.close();
    }

    const poor = await buyerRig({}, 5_000_000n);
    try {
      ok(await poor.r.source.setWallet(poor.buyer));
      assert.equal(refused(await poor.r.source.mintCitizen()), 'insufficient-sol');
      assert.equal(poor.buyer.prompts.transaction, 0);
    } finally {
      await poor.r.close();
    }

    const visitor = await buyerRig();
    try {
      assert.equal(refused(await visitor.r.source.mintCitizen()), 'not-connected');
    } finally {
      await visitor.r.close();
    }
  });

  it('changes nothing when the person closes the wallet request', async () => {
    const { r, buyer } = await buyerRig();
    try {
      ok(await r.source.setWallet(buyer));
      buyer.decline = true;
      assert.equal(refused(await r.source.mintCitizen()), 'declined');
      assert.equal(r.source.snapshot().mint.minted, 0);
      assert.equal(r.world.applied.length, 0);
    } finally {
      await r.close();
    }
  });

  it('reports unavailable while the machine is not fully loaded, without a wallet prompt for the transaction', async () => {
    const { r, buyer } = await buyerRig({ loaded: false });
    try {
      ok(await r.source.setWallet(buyer));
      assert.equal(refused(await r.source.mintCitizen()), 'unavailable');
      assert.equal(buyer.prompts.transaction, 0);
    } finally {
      await r.close();
    }
  });

  it('reports a mint the cluster refuses after the signature, and nothing is paid', async () => {
    const { r, buyer } = await buyerRig();
    try {
      ok(await r.source.setWallet(buyer));
      // The cluster counts this wallet as at its limit although the page did not know yet.
      r.world.sale_!.limit = 0;
      assert.equal(refused(await r.source.mintCitizen()), 'transaction-failed');
      assert.equal(r.source.snapshot().mint.minted, 0);
      assert.equal(r.source.snapshot().wallet.solLamports, 1_000_000_000n, 'nothing was paid');
    } finally {
      await r.close();
    }
  });
});

describe('market on chain', () => {
  const PRICE = 650_000_000n;

  /** The owner lists citizen A at `PRICE`. */
  async function listed(): Promise<Rig> {
    const r = await rig({ market: 'open' });
    ok(await r.source.setWallet(r.owner));
    ok(await r.source.listCitizen(A, PRICE));
    return r;
  }

  /** A third wallet with SOL, connected, that holds no citizen. */
  async function buyerOf(r: Rig, sol = 2_000_000_000n): Promise<TestWallet> {
    const buyer = testWallet();
    r.world.sol.set(buyer.address, sol);
    ok(await r.source.setWallet(buyer));
    return buyer;
  }

  it('reads the config and shows the market open with no listings', async () => {
    const r = await rig({ market: 'open' });
    try {
      const { market } = ok(await r.source.setWallet(r.owner));
      assert.equal(market.open, true);
      assert.equal(market.royaltyBps, 500);
      assert.deepEqual(market.listings, []);
    } finally {
      await r.close();
    }
  });

  it('lists with one signature that names the market as delegate', async () => {
    const r = await listed();
    try {
      assert.equal(r.owner.prompts.transaction, 1);
      const listing = r.world.listingOf(r.asset.a);
      assert.equal(listing?.priceLamports, PRICE);
      assert.equal(listing?.seller, r.owner.address);
      assert.deepEqual(r.world.find(r.asset.a).delegate, { kind: 'address', address: MARKET_AUTHORITY });
      const [shown] = r.source.snapshot().market.listings;
      assert.deepEqual(shown, { citizenId: A, seller: `${r.owner.address.slice(0, 4)}…${r.owner.address.slice(-3)}`, priceLamports: PRICE, listedDay: 1 });
      assert.deepEqual(r.source.snapshot().owned.includes(A), true, 'a listed citizen stays in the wallet');
    } finally {
      await r.close();
    }
  });

  it('refuses a second listing, a price out of range and a citizen of someone else before the wallet is asked', async () => {
    const r = await listed();
    try {
      assert.equal(refused(await r.source.listCitizen(A, PRICE)), 'already-listed');
      assert.equal(refused(await r.source.listCitizen(C, 1_000n)), 'invalid-price');
      assert.equal(refused(await r.source.listCitizen(B, PRICE)), 'not-owner');
      assert.equal(refused(await r.source.changeListingPrice(C, PRICE)), 'not-listed');
      assert.equal(r.owner.prompts.transaction, 1);
    } finally {
      await r.close();
    }
  });

  it('changes the price, and asks nothing when the price is the same', async () => {
    const r = await listed();
    try {
      ok(await r.source.changeListingPrice(A, PRICE));
      assert.equal(r.owner.prompts.transaction, 1);
      const snapshot = ok(await r.source.changeListingPrice(A, 900_000_000n));
      assert.equal(snapshot.market.listings[0]?.priceLamports, 900_000_000n);
      assert.equal(r.world.listingOf(r.asset.a)?.priceLamports, 900_000_000n);
    } finally {
      await r.close();
    }
  });

  it('sells: the buyer takes the citizen, the seller gets the price less 5%, and the creators get the 5%', async () => {
    const r = await listed();
    try {
      const sellerBefore = r.world.sol.get(r.owner.address) ?? 0n;
      const buyer = await buyerOf(r);
      const snapshot = ok(await r.source.buyCitizen(A));
      assert.equal(buyer.prompts.transaction, 1);
      assert.deepEqual(snapshot.owned, [A]);
      assert.deepEqual(snapshot.market.listings, []);
      assert.equal(snapshot.wallet.solLamports, 2_000_000_000n - PRICE);
      assert.equal((r.world.sol.get(r.owner.address) ?? 0n) - sellerBefore, 617_500_000n);
      assert.equal(r.world.sol.get(TREASURY), 32_500_000n);
      assert.deepEqual(r.world.find(r.asset.a).delegate, { kind: 'owner' }, 'Core hands the delegate back');
    } finally {
      await r.close();
    }
  });

  it('protects a buyer from a price raised after the listing was read', async () => {
    const r = await listed();
    try {
      const buyer = await buyerOf(r);
      // The seller raises the price from another device; this page still shows the old one.
      for (const [key, listing] of r.world.listings) r.world.listings.set(key, { ...listing, priceLamports: 900_000_000n });
      assert.equal(refused(await r.source.buyCitizen(A)), 'price-changed');
      assert.equal(r.world.find(r.asset.a).owner, r.owner.address);
      assert.equal(r.world.sol.get(buyer.address), 2_000_000_000n);
      assert.equal(r.source.snapshot().market.listings[0]?.priceLamports, 900_000_000n, 'the new price is on screen');
    } finally {
      await r.close();
    }
  });

  it('refuses buying your own citizen, a purchase without enough SOL and a listing that is gone', async () => {
    const r = await listed();
    try {
      assert.equal(refused(await r.source.buyCitizen(A)), 'own-listing');
      await buyerOf(r, 100_000_000n);
      assert.equal(refused(await r.source.buyCitizen(A)), 'insufficient-sol');
      assert.equal(refused(await r.source.buyCitizen(C)), 'listing-gone');
    } finally {
      await r.close();
    }
  });

  it('hides a listing whose citizen moved, and lets the new owner list it over the old one', async () => {
    const r = await listed();
    try {
      const buyer = await buyerOf(r);
      r.world.transfer(r.asset.a, buyer.address);
      const snapshot = ok(await r.source.refresh!());
      assert.deepEqual(snapshot.market.listings, [], 'the old listing cannot sell any more');
      assert.equal(refused(await r.source.buyCitizen(A)), 'listing-gone');

      ok(await r.source.listCitizen(A, 1_000_000_000n));
      const listing = r.world.listingOf(r.asset.a);
      assert.equal(listing?.seller, buyer.address);
      assert.equal(r.world.listings.size, 1, 'the old listing was closed in the same transaction');
      assert.equal(r.source.snapshot().market.listings.length, 1);
    } finally {
      await r.close();
    }
  });

  it('cancels and takes the delegate back, also while the market is paused', async () => {
    const r = await listed();
    try {
      r.world.marketConfig = { ...r.world.marketConfig!, isPaused: true };
      const paused = ok(await r.source.refresh!());
      assert.equal(paused.market.open, false);
      assert.equal(refused(await r.source.listCitizen(C, PRICE)), 'market-closed');
      assert.equal(refused(await r.source.changeListingPrice(A, 900_000_000n)), 'market-closed');

      const snapshot = ok(await r.source.cancelListing(A));
      assert.deepEqual(snapshot.market.listings, []);
      assert.equal(r.world.listings.size, 0);
      assert.deepEqual(r.world.find(r.asset.a).delegate, { kind: 'owner' });
      assert.equal(refused(await r.source.cancelListing(A)), 'not-listed');
    } finally {
      await r.close();
    }
  });

  it('changes nothing when the person closes the wallet request', async () => {
    const r = await rig({ market: 'open' });
    try {
      ok(await r.source.setWallet(r.owner));
      r.owner.decline = true;
      assert.equal(refused(await r.source.listCitizen(A, PRICE)), 'declined');
      assert.equal(r.world.listings.size, 0);
      assert.equal(r.world.find(r.asset.a).delegate, null);
    } finally {
      await r.close();
    }
  });

  it('undoes the delegate when the listing itself is refused', async () => {
    const r = await rig({ market: 'open' });
    try {
      ok(await r.source.setWallet(r.owner));
      // Paused on chain after this page read it open.
      r.world.marketConfig = { ...r.world.marketConfig!, isPaused: true };
      assert.equal(refused(await r.source.listCitizen(A, PRICE)), 'market-closed');
      assert.equal(r.world.find(r.asset.a).delegate, null, 'the Core instruction was rolled back with it');
      assert.equal(r.source.snapshot().market.open, false, 'the page read the pause');
    } finally {
      await r.close();
    }
  });
});

describe('auctions on chain', () => {
  const START = 500_000_000n;
  const HOUR = 3_600;

  /** The owner puts citizen A up for a 24-hour auction from `START`. */
  async function auctioned(): Promise<Rig> {
    const r = await rig({ market: 'open' });
    ok(await r.source.setWallet(r.owner));
    ok(await r.source.auctionCitizen(A, START, 24));
    return r;
  }

  async function bidder(r: Rig, sol = 2_000_000_000n): Promise<TestWallet> {
    const wallet = testWallet();
    r.world.sol.set(wallet.address, sol);
    ok(await r.source.setWallet(wallet));
    return wallet;
  }

  /** The owner's citizen A in an auction from before the market held its citizens. */
  async function legacyAuctioned(): Promise<Rig> {
    const r = await rig({ market: 'open' });
    ok(await r.source.setWallet(r.owner));
    await r.world.legacyAuction(r.asset.a, START, 24);
    ok(await r.source.refresh!());
    return r;
  }

  it('starts with one signature and the market holds the citizen until it ends', async () => {
    const r = await auctioned();
    try {
      assert.equal(r.owner.prompts.transaction, 1);
      const asset = r.world.find(r.asset.a);
      assert.deepEqual([asset.owner, asset.frozen], [MARKET_AUTHORITY, false]);
      const [shown] = r.source.snapshot().market.auctions;
      assert.equal(shown?.citizenId, A);
      assert.equal(shown?.highestBidLamports, null);
      assert.equal(shown?.minBidLamports, START);
      assert.equal(shown?.endsAt, SEASON_START + HOUR + 24 * HOUR);
      assert.equal(shown?.deliverable, true);
      assert.equal(shown?.sellerIsMe, true);
      assert.ok(!r.source.snapshot().owned.includes(A), 'not among the wallet\'s citizens while the market holds it');
      assert.equal(refused(await r.source.listCitizen(A, START)), 'in-auction');
      assert.equal(refused(await r.source.auctionCitizen(A, START, 24)), 'in-auction');
      assert.equal(refused(await r.source.auctionCitizen(C, START, 36)), 'invalid-price');
      assert.equal(r.owner.prompts.transaction, 1, 'refused before the wallet was asked');
    } finally {
      await r.close();
    }
  });

  it('holds the bid, pays it back when someone bids more, and tells the bidder who was beaten', async () => {
    const r = await auctioned();
    try {
      assert.equal(refused(await r.source.placeBid(A, START)), 'own-listing');
      const first = await bidder(r);
      ok(await r.source.placeBid(A, START));
      assert.equal(r.world.sol.get(first.address), 2_000_000_000n - START);
      assert.equal(r.source.snapshot().market.auctions[0]?.leading, true);
      assert.equal(refused(await r.source.placeBid(A, START * 2n)), 'already-highest');

      const second = await bidder(r);
      assert.equal(refused(await r.source.placeBid(A, 524_999_999n)), 'bid-too-low');
      assert.equal(second.prompts.transaction, 0);
      ok(await r.source.placeBid(A, 525_000_000n));
      assert.equal(r.world.sol.get(first.address), 2_000_000_000n, 'the first bid came back in full');
      const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-3)}`;
      assert.deepEqual(
        r.source.snapshot().market.auctions[0]?.bids.map((bid) => [bid.bidder, bid.amountLamports, bid.mine]),
        [
          [short(second.address), 525_000_000n, true],
          [short(first.address), START, false],
        ],
      );

      const seen = ok(await r.source.setWallet(first));
      assert.equal(seen.market.auctions[0]?.leading, false);
      assert.equal(seen.market.auctions[0]?.minBidLamports, 551_250_000n);
      assert.deepEqual(
        seen.market.notices.map((notice) => notice.kind === 'outbid' && [notice.citizenId, notice.refundedLamports]),
        [[A, START]],
      );
      // Bidding again answers the notice.
      ok(await r.source.placeBid(A, 551_250_000n));
      assert.deepEqual(r.source.snapshot().market.notices, []);
    } finally {
      await r.close();
    }
  });

  it('runs ten minutes past a late bid, then anyone finishes it: the winner takes the citizen and the seller is paid', async () => {
    const r = await auctioned();
    try {
      const winner = await bidder(r);
      r.clock.advance(24 * HOUR - 120);
      ok(await r.source.placeBid(A, START));
      const endsAt = r.source.snapshot().market.auctions[0]?.endsAt ?? 0;
      assert.equal(endsAt, SEASON_START + HOUR + 24 * HOUR - 120 + 600);

      const sellerBefore = r.world.sol.get(r.owner.address) ?? 0n;
      ok(await r.source.setWallet(r.stranger));
      r.clock.advance(300);
      assert.equal(refused(await r.source.settleAuction(A)), 'auction-live');
      r.clock.advance(300);
      assert.equal(refused(await r.source.placeBid(A, START * 2n)), 'auction-ended');
      const done = ok(await r.source.settleAuction(A));
      assert.deepEqual(done.market.auctions, []);

      const asset = r.world.find(r.asset.a);
      assert.deepEqual([asset.owner, asset.frozen], [winner.address, false]);
      assert.equal((r.world.sol.get(r.owner.address) ?? 0n) - sellerBefore, 475_000_000n);
      assert.equal(r.world.sol.get(TREASURY), 25_000_000n);
      assert.equal(done.history[A]?.[0]?.kind, 'sale', 'anyone sees the sale in the public history');

      const seller = ok(await r.source.setWallet(r.owner));
      assert.ok(!seller.owned.includes(A));
      const [sold] = seller.market.notices;
      assert.deepEqual(sold?.kind === 'sold' && [sold.citizenId, sold.priceLamports, sold.proceedsLamports, sold.viaAuction], [A, START, 475_000_000n, true]);
      const won = ok(await r.source.setWallet(winner));
      assert.ok(won.owned.includes(A));
      assert.deepEqual(won.market.notices.map((notice) => notice.kind), ['won']);
    } finally {
      await r.close();
    }
  });

  it('lists a finished auction under the sales with exactly its own chain of bids', async () => {
    const r = await auctioned();
    try {
      // A bid from an earlier auction of the same citizen, by a wallet that bids again now.
      const first = await bidder(r);
      r.world.activity.bids.push({
        signature: 'earlier',
        asset: r.asset.a,
        bidder: first.address,
        amountLamports: '900000000',
        previousBidder: null,
        at: SEASON_START,
      });
      ok(await r.source.placeBid(A, START));
      const second = await bidder(r);
      ok(await r.source.placeBid(A, 525_000_000n));
      ok(await r.source.setWallet(first));
      ok(await r.source.placeBid(A, 551_250_000n));
      r.clock.advance(24 * HOUR);
      const done = ok(await r.source.settleAuction(A));

      const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-3)}`;
      const [sale] = done.market.sales;
      assert.deepEqual(
        sale && [sale.citizenId, sale.kind, sale.priceLamports, sale.seller, sale.buyer, sale.buyerIsMe, sale.sellerIsMe],
        [A, 'auction', 551_250_000n, short(r.owner.address), short(first.address), true, false],
      );
      assert.deepEqual(
        sale?.bids.map((bid) => [bid.bidder, bid.amountLamports, bid.mine]),
        [
          [short(first.address), 551_250_000n, true],
          [short(second.address), 525_000_000n, false],
          [short(first.address), START, true],
        ],
        'newest first, ending at the first bid, without the bid of the earlier auction',
      );
      const seller = ok(await r.source.setWallet(r.owner));
      assert.deepEqual(seller.market.sales.map((item) => [item.sellerIsMe, item.buyerIsMe]), [[true, false]]);
    } finally {
      await r.close();
    }
  });

  it('cancels until the first bid, handing the citizen back', async () => {
    const r = await auctioned();
    try {
      const snapshot = ok(await r.source.cancelAuction(A));
      assert.deepEqual(snapshot.market.auctions, []);
      assert.equal(r.world.find(r.asset.a).owner, r.owner.address);
      assert.ok(snapshot.owned.includes(A));

      ok(await r.source.auctionCitizen(A, START, 48));
      await bidder(r);
      ok(await r.source.placeBid(A, START));
      ok(await r.source.setWallet(r.owner));
      assert.equal(refused(await r.source.cancelAuction(A)), 'auction-has-bids');
    } finally {
      await r.close();
    }
  });

  it('lists a bid the server has not read yet from the auction account, and none from an earlier auction', async () => {
    const r = await auctioned();
    try {
      // A bid from an auction of the same citizen that ended before this one started.
      r.world.activity.bids.push({
        signature: 'earlier',
        asset: r.asset.a,
        bidder: r.owner.address,
        amountLamports: '1',
        previousBidder: null,
        at: SEASON_START,
      });
      const first = await bidder(r);
      ok(await r.source.placeBid(A, START));
      const second = await bidder(r);
      ok(await r.source.placeBid(A, 525_000_000n));
      // The server is a few seconds behind: it has read only the first bid.
      r.world.activity.bids.shift();
      const seen = ok(await r.source.setWallet(first));
      const bids = seen.market.auctions[0]?.bids ?? [];
      assert.deepEqual(
        bids.map((bid) => [bid.amountLamports, bid.at === null, bid.mine]),
        [
          [525_000_000n, true, false],
          [START, false, true],
        ],
      );
      assert.equal(bids[0]?.bidder, `${second.address.slice(0, 4)}…${second.address.slice(-3)}`);
    } finally {
      await r.close();
    }
  });

  it('runs a whole auction in minutes on the devnet test clock', async () => {
    const fast = AUCTION_CLOCKS['devnet-fast'];
    const r = await rig({ market: 'open', auctionClock: fast });
    try {
      ok(await r.source.setWallet(r.owner));
      const startedAt = Math.floor(r.clock.now / 1000);
      const started = ok(await r.source.auctionCitizen(A, START, 24));
      assert.equal(started.market.auctionClock, fast);
      assert.equal(started.market.auctions[0]?.endsAt, startedAt + 24 * 10, 'a 24-hour auction lasts four minutes');

      const winner = await bidder(r);
      r.clock.advance(24 * 10 - 30);
      ok(await r.source.placeBid(A, START));
      assert.equal(r.source.snapshot().market.auctions[0]?.endsAt, startedAt + 24 * 10 - 30 + 60, 'a late bid adds one minute');
      r.clock.advance(59);
      assert.equal(refused(await r.source.settleAuction(A)), 'auction-live');
      r.clock.advance(1);
      ok(await r.source.settleAuction(A));
      assert.equal(r.world.find(r.asset.a).owner, winner.address);
    } finally {
      await r.close();
    }
  });

  it('ends an auction nobody bid on with the citizen free again at home', async () => {
    const r = await auctioned();
    try {
      r.clock.advance(24 * HOUR);
      ok(await r.source.settleAuction(A));
      const asset = r.world.find(r.asset.a);
      assert.deepEqual([asset.owner, asset.frozen], [r.owner.address, false]);
      ok(await r.source.listCitizen(A, START));
    } finally {
      await r.close();
    }
  });

  it('still settles an older auction, with the citizen frozen at home, for the winner', async () => {
    const r = await legacyAuctioned();
    try {
      const [shown] = r.source.snapshot().market.auctions;
      assert.deepEqual([shown?.deliverable, shown?.sellerIsMe], [true, true]);
      assert.ok(r.source.snapshot().owned.includes(A), 'an older auction leaves the citizen in the wallet');
      const winner = await bidder(r);
      ok(await r.source.placeBid(A, START));
      r.clock.advance(24 * HOUR);
      ok(await r.source.settleAuction(A));
      const asset = r.world.find(r.asset.a);
      assert.deepEqual([asset.owner, asset.frozen, asset.delegate, asset.freeze], [winner.address, false, { kind: 'owner' }, { kind: 'owner' }]);
    } finally {
      await r.close();
    }
  });

  it('cancels an older auction by thawing the citizen and taking both delegates back', async () => {
    const r = await legacyAuctioned();
    try {
      const snapshot = ok(await r.source.cancelAuction(A));
      assert.deepEqual(snapshot.market.auctions, []);
      const asset = r.world.find(r.asset.a);
      assert.deepEqual([asset.owner, asset.frozen, asset.delegate, asset.freeze], [r.owner.address, false, { kind: 'owner' }, { kind: 'owner' }]);
    } finally {
      await r.close();
    }
  });

  it('pays the bid back at once when the seller of an older auction takes the right to move the citizen away', async () => {
    const r = await legacyAuctioned();
    try {
      const first = await bidder(r);
      ok(await r.source.placeBid(A, START));
      // Core lets the owner revoke the TransferDelegate even while frozen.
      r.world.find(r.asset.a).delegate = { kind: 'owner' };
      const second = await bidder(r);
      const stopped = ok(await r.source.refresh!());
      assert.equal(stopped.market.auctions[0]?.deliverable, false);
      assert.equal(refused(await r.source.placeBid(A, START * 2n)), 'listing-gone');
      ok(await r.source.settleAuction(A));
      assert.equal(r.world.sol.get(first.address), 2_000_000_000n);
      assert.equal(r.world.find(r.asset.a).owner, r.owner.address);
      assert.equal(second.prompts.transaction, 1);
    } finally {
      await r.close();
    }
  });

  it('tells a seller of a fixed-price sale what reached the wallet, and records the sale', async () => {
    const r = await rig({ market: 'open' });
    try {
      ok(await r.source.setWallet(r.owner));
      ok(await r.source.listCitizen(A, START));
      await bidder(r);
      ok(await r.source.buyCitizen(A));
      const seller = ok(await r.source.setWallet(r.owner));
      const [sold] = seller.market.notices;
      assert.deepEqual(sold?.kind === 'sold' && [sold.citizenId, sold.proceedsLamports, sold.viaAuction], [A, 475_000_000n, false]);
      ok(await r.source.setWallet(r.stranger));
      assert.deepEqual(r.source.snapshot().history[A]?.[0], { day: 1, kind: 'sale', priceLamports: START });
    } finally {
      await r.close();
    }
  });
});
