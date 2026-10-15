import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MAX_STAT_SCORE, STAT_KEYS } from '@bas/content';
import { loadCitizens } from '@bas/content/server';
import { trainingCostAtoms } from '@bas/chain-client/stats';

import { DISTRICT_RULES } from '../src/lib/data/districts.ts';
import { planJourney, tierUpOf, type JourneyInput } from '../src/lib/data/journey.ts';
import { createMockDataSource } from '../src/lib/data/mock/mockDataSource.ts';
import { MOCK_ANSWERS } from '../src/lib/data/mock/mockSnapshot.ts';
import type { MissionStep } from '../src/lib/data/types.ts';

const BASE = '100000000';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roster = loadCitizens();
const PRICE = '10000000';
const source = (limit = 2) =>
  createMockDataSource({ roster, baseTrainingCostAtoms: BASE, mintPriceLamports: PRICE, mintLimitPerWallet: limit, random: () => 0 });

// The wallet owns three veterans; Pip is the one citizen left to mint, so the route of a new citizen starts from a mint.
const minting = source();
const minted = await minting.mintCitizen();
assert.ok(minted.ok, 'the first mint succeeds');
const snapshot = minting.snapshot();

const citizen = (id: number) => {
  const found = snapshot.citizens.find((item) => item.id === id);
  assert.ok(found, `citizen ${id} is in the mock roster`);
  return found;
};
const input = (overrides: Partial<JourneyInput> = {}): JourneyInput => ({
  owned: snapshot.owned,
  credits: snapshot.credits,
  wallet: snapshot.wallet,
  missions: snapshot.missions,
  missionProgress: {},
  history: snapshot.history,
  season: snapshot.season,
  baseTrainingCostAtoms: BASE,
  ...overrides,
});

describe('minting', () => {
  it('draws the citizen that is left and registers it at its role scores', () => {
    assert.equal(minted.ok && minted.citizenId, 12);
    assert.ok(snapshot.owned.includes(12));
    const pip = citizen(12);
    assert.equal(pip.registered, true);
    assert.deepEqual([pip.intelligence, pip.alignment, pip.compute], [1, 1, 1]);
    assert.deepEqual(snapshot.credits[12], { intelligence: 0, alignment: 0, compute: 0 });
    assert.equal(snapshot.history[12]?.[0]?.kind, 'register');
  });

  it('takes the price in SOL and counts the citizen', () => {
    const fresh = source().snapshot();
    assert.equal(fresh.wallet.solLamports - snapshot.wallet.solLamports, BigInt(PRICE));
    assert.equal(snapshot.mint.minted, fresh.mint.minted + 1);
    assert.equal(fresh.owned.includes(12), false);
  });

  it('refuses a second mint once the roster is minted', async () => {
    const again = await minting.mintCitizen();
    assert.deepEqual(again, { ok: false, error: 'sold-out' });
  });

  it('stops a wallet at its mint limit before it looks at what is left', async () => {
    const limited = source(1);
    assert.ok((await limited.mintCitizen()).ok);
    assert.deepEqual(await limited.mintCitizen(), { ok: false, error: 'mint-limit' });
    assert.equal(limited.snapshot().mint.mintedByWallet, 1);
  });

  it('refuses a mint the wallet cannot pay', async () => {
    const poor = createMockDataSource({ roster, baseTrainingCostAtoms: BASE, mintPriceLamports: '3000000000', mintLimitPerWallet: 2, random: () => 0 });
    assert.deepEqual(await poor.mintCitizen(), { ok: false, error: 'insufficient-sol' });
  });

  it('can start a wallet that owns nothing', () => {
    const empty = createMockDataSource({ roster, baseTrainingCostAtoms: BASE, mintPriceLamports: PRICE, mintLimitPerWallet: 2, start: 'empty' });
    assert.deepEqual(empty.snapshot().owned, []);
  });
});

describe('route of a new citizen', () => {
  const pip = citizen(12);
  const journey = planJourney(input(), pip);

  it('starts at Tier 0 with two levels to go on every stat', () => {
    assert.equal(journey.tier, 0);
    for (const path of journey.paths) {
      assert.equal(path.nextTier, 1);
      assert.equal(path.upgradesLeft, 2);
      assert.equal(path.creditsMissing, 2);
    }
  });

  it('estimates the days to Tier 1 from one mission a day', () => {
    // Every stat has exactly one mission open to a Tier 0 citizen, so two missing credits take two days.
    assert.deepEqual(journey.pace, { stat: 'intelligence', tier: 1, days: 2 });
  });

  it('gives no estimate when a tier can be reached today', () => {
    const ready = planJourney(
      input({ credits: { ...snapshot.credits, 12: { intelligence: 2, alignment: 0, compute: 0 } } }),
      pip,
    );
    assert.equal(ready.pace, null);
  });

  it('adds up the token cost of every upgrade to the next tier', () => {
    const expected = trainingCostAtoms(BASE, 1) + trainingCostAtoms(BASE, 2);
    assert.equal(journey.paths[0]?.tierCost, expected);
  });

  it('points at a mission that is open to everyone', () => {
    assert.deepEqual(journey.next, { kind: 'start-mission', missionId: 'lightsOut', stat: 'intelligence' });
  });

  it('names the district a stat opens at the next tier', () => {
    const bond = journey.paths.find((path) => path.stat === 'alignment');
    assert.deepEqual(bond?.opens, ['watch']);
    const insight = journey.paths.find((path) => path.stat === 'intelligence');
    assert.deepEqual(insight?.opens, []);
  });

  it('lists the locked missions with the reason', () => {
    const craft = journey.paths.find((path) => path.stat === 'compute');
    const blockers = Object.fromEntries((craft?.missions ?? []).map((option) => [option.mission.id, option.blocker]));
    assert.equal(blockers.streetLamp, null);
    assert.equal(blockers.nightPatrol, 'district-locked');
    assert.equal(blockers.ruinsExpedition, 'district-locked');
  });
});

describe('next step', () => {
  it('finishes the mission in progress when no upgrade reaches a tier', () => {
    const journey = planJourney(input({ missionProgress: { nightPatrol: { citizenId: 4, done: 1, stat: 'alignment' } } }), citizen(4));
    assert.deepEqual(journey.next, { kind: 'continue-mission', missionId: 'nightPatrol', step: 2, steps: 4 });
  });

  it('puts an upgrade that reaches a tier ahead of the mission in progress', () => {
    const journey = planJourney(input({ missionProgress: { streetLamp: { citizenId: 1, done: 1, stat: 'compute' } } }), citizen(1));
    assert.equal(journey.next.kind, 'train');
  });

  it('trains the stat that reaches a tier when it can pay for it', () => {
    const journey = planJourney(input(), citizen(1));
    assert.equal(journey.next.kind, 'train');
    if (journey.next.kind === 'train') {
      assert.equal(journey.next.stat, 'alignment');
      assert.equal(journey.next.reachesTier, 1);
      assert.equal(journey.next.cost, trainingCostAtoms(BASE, 2));
    }
  });

  it('asks for tokens when a credit is held but the wallet is short', () => {
    const journey = planJourney(input({ wallet: { ...snapshot.wallet, tokenAtoms: 0n } }), citizen(1));
    assert.equal(journey.next.kind, 'earn-tokens');
    if (journey.next.kind === 'earn-tokens') assert.equal(journey.next.missing, trainingCostAtoms(BASE, 2));
  });

  it('says to wait once every useful mission is done for today', () => {
    const today = snapshot.season.day;
    const done = ['lightsOut', 'hearthDeliveries', 'streetLamp'].map((missionId, index) => ({
      day: today,
      kind: 'mission' as const,
      missionId,
      stat: STAT_KEYS[index] as (typeof STAT_KEYS)[number],
    }));
    const journey = planJourney(input({ history: { ...snapshot.history, 12: done } }), citizen(12));
    assert.deepEqual(journey.next, { kind: 'wait', reason: 'cooldown' });
  });

  it('is not a path for a citizen owned by someone else', () => {
    assert.deepEqual(planJourney(input(), citizen(3)).next, { kind: 'not-owner' });
  });

  it('is complete when every stat is at the maximum', () => {
    const maxed = { ...citizen(1), intelligence: MAX_STAT_SCORE, alignment: MAX_STAT_SCORE, compute: MAX_STAT_SCORE };
    const journey = planJourney(input(), maxed);
    assert.equal(journey.tier, 3);
    assert.deepEqual(journey.next, { kind: 'complete' });
  });
});

describe('tier ladder', () => {
  it('marks a rung reached from the best stat of the citizen', () => {
    const rungs = planJourney(input(), citizen(2)).rungs;
    assert.deepEqual(rungs.map((rung) => rung.reached), [true, true, false]);
    assert.deepEqual(rungs.map((rung) => rung.score), [3, 6, 10]);
  });

  it('opens the Summit mission only at a score of 10', () => {
    const summit = (id: number, patch = {}) =>
      planJourney(input(), { ...citizen(id), ...patch })
        .paths.flatMap((path) => path.missions)
        .find((option) => option.mission.id === 'summitTrial')?.blocker;
    assert.equal(summit(1), 'district-locked');
    assert.equal(summit(1, { compute: MAX_STAT_SCORE }), null);
  });

  it('reports what a training step opened', () => {
    const before = citizen(1);
    const up = tierUpOf(before, { ...before, alignment: 3 }, 'alignment');
    assert.deepEqual(up, { stat: 'alignment', tier: 1, opened: [] });
    const craft = tierUpOf({ ...before, compute: 5 }, { ...before, compute: 6 }, 'compute');
    assert.deepEqual(craft, { stat: 'compute', tier: 2, opened: ['frontier'] });
    assert.equal(tierUpOf({ ...before, compute: 1 }, { ...before, compute: 2 }, 'compute'), null);
  });
});

describe('mission data', () => {
  const layout = JSON.parse(readFileSync(join(root, 'src/game/cityLayout.json'), 'utf8')) as {
    size: number;
    cells: string[][];
    blocked: [number, number][];
  };
  const blocked = new Set(layout.blocked.map(([gx, gy]) => `${gx},${gy}`));
  const copy = JSON.parse(readFileSync(join(root, 'src/messages/en.json'), 'utf8')) as {
    missions: { catalog: Record<string, { steps: Record<string, unknown>[] }> };
  };

  const reachable = (() => {
    const seen = new Set<string>(['18,19']);
    const queue: [number, number][] = [[18, 19]];
    while (queue.length > 0) {
      const [gx, gy] = queue.shift() as [number, number];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next: [number, number] = [gx + dx, gy + dy];
        const key = `${next[0]},${next[1]}`;
        const inside = next[0] >= 0 && next[1] >= 0 && next[0] < layout.size && next[1] < layout.size;
        if (inside && !blocked.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push(next);
        }
      }
    }
    return seen;
  })();

  it('sends citizens only to free cells they can walk to from the plaza', () => {
    for (const mission of snapshot.missions) {
      for (const step of mission.steps) {
        if (step.kind !== 'goto') continue;
        const key = `${step.cell[0]},${step.cell[1]}`;
        assert.ok(!blocked.has(key), `${mission.id}: ${key} is blocked`);
        assert.ok(reachable.has(key), `${mission.id}: ${key} cannot be reached`);
      }
    }
  });

  it('walks to the district a mission belongs to', () => {
    for (const mission of snapshot.missions) {
      const targets = mission.steps.filter((step): step is Extract<MissionStep, { kind: 'goto' }> => step.kind === 'goto');
      if (targets.length === 0) continue;
      assert.ok(
        targets.some((step) => layout.cells[step.cell[1]]?.[step.cell[0]] === mission.district),
        `${mission.id}: no step ends in ${mission.district}`,
      );
    }
  });

  it('has written copy that matches every step', () => {
    for (const mission of snapshot.missions) {
      const text = copy.missions.catalog[mission.id];
      assert.ok(text, `${mission.id}: missing copy`);
      assert.equal(text.steps.length, mission.steps.length, `${mission.id}: step count`);
      mission.steps.forEach((step, index) => {
        const entry = text.steps[index] as { hint?: string; prompt?: string; options?: string[]; pieces?: string[] };
        if (step.kind === 'goto') assert.ok(entry.hint, `${mission.id}[${index}]: hint`);
        if (step.kind === 'talk') {
          assert.equal(entry.options?.length, 3, `${mission.id}[${index}]: three replies`);
          const answer = MOCK_ANSWERS[mission.id]?.[index];
          assert.ok(answer !== undefined && answer >= 0 && answer < 3, `${mission.id}[${index}]: answer index`);
        }
        if (step.kind === 'puzzle') assert.ok((entry.pieces?.length ?? 0) >= 3, `${mission.id}[${index}]: pieces`);
      });
    }
  });

  it('gives every stat a mission a brand-new citizen can start', () => {
    for (const stat of STAT_KEYS) {
      const open = snapshot.missions.filter(
        (mission) =>
          mission.rewards.includes(stat) &&
          mission.opensInHours === undefined &&
          DISTRICT_RULES[mission.district].unlockScore === 0,
      );
      assert.ok(open.length > 0, `${stat} has no starting mission`);
    }
  });

  it('has a mission in every district that opens at a tier', () => {
    for (const rule of Object.values(DISTRICT_RULES)) {
      if (rule.unlockScore === 0) continue;
      assert.ok(
        snapshot.missions.some((mission) => mission.district === rule.id),
        `${rule.id} opens at ${rule.unlockScore} but has no mission`,
      );
    }
  });
});
