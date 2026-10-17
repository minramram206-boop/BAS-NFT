import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MISSIONS,
  MIN_MS_PER_CELL,
  MIN_STEP_MS,
  MissionError,
  assertCanStart,
  checkStep,
  findMission,
  parseProof,
  type StartContext,
} from '../dist/index.js';

const lamp = findMission('streetLamp')!;
const patrol = findMission('nightPatrol')!;

function context(overrides: Partial<StartContext> = {}): StartContext {
  return {
    mission: lamp,
    stat: 'compute',
    scores: { intelligence: 1, alignment: 1, compute: 1 },
    doneToday: [],
    hasSession: false,
    seasonOpen: true,
    eventOpen: false,
    ...overrides,
  };
}

function refusal(action: () => void): string {
  try {
    action();
  } catch (error) {
    if (error instanceof MissionError) return error.code;
    throw error;
  }
  return 'none';
}

describe('catalog', () => {
  it('uses unique ids and chain ids', () => {
    assert.equal(new Set(MISSIONS.map((mission) => mission.id)).size, MISSIONS.length);
    assert.equal(new Set(MISSIONS.map((mission) => mission.chainId)).size, MISSIONS.length);
  });

  it('gives every talk step a valid answer and every puzzle at least two pieces', () => {
    for (const mission of MISSIONS) {
      for (const step of mission.steps) {
        if (step.kind === 'talk') assert.ok(step.answer >= 0 && step.answer < step.options, mission.id);
        if (step.kind === 'puzzle') assert.ok(step.pieces >= 2, mission.id);
      }
    }
  });
});

describe('starting a mission', () => {
  it('accepts a plain start', () => {
    assert.equal(refusal(() => assertCanStart(context())), 'none');
  });

  it('refuses a stat the mission does not reward', () => {
    assert.equal(
      refusal(() => assertCanStart(context({ mission: patrol, scores: { intelligence: 0, alignment: 3, compute: 0 }, stat: 'intelligence' }))),
      'invalid-stat',
    );
  });

  it('keeps the district locked until a stat reaches the unlock score', () => {
    const watch = context({ mission: patrol, stat: 'alignment' });
    assert.equal(refusal(() => assertCanStart(watch)), 'district-locked');
    assert.equal(
      refusal(() => assertCanStart({ ...watch, scores: { intelligence: 0, alignment: 3, compute: 0 } })),
      'none',
    );
  });

  it('refuses a second mission, a repeat on the same day and a fourth credit', () => {
    assert.equal(refusal(() => assertCanStart(context({ hasSession: true }))), 'citizen-busy');
    assert.equal(refusal(() => assertCanStart(context({ doneToday: ['streetLamp'] }))), 'mission-cooldown');
    assert.equal(
      refusal(() => assertCanStart(context({ doneToday: ['lightsOut', 'hearthDeliveries', 'nightPatrol'] }))),
      'daily-limit',
    );
  });

  it('opens event missions only inside their window', () => {
    const event = findMission('blackoutNight')!;
    assert.equal(refusal(() => assertCanStart(context({ mission: event, stat: 'compute' }))), 'mission-closed');
    assert.equal(refusal(() => assertCanStart(context({ mission: event, stat: 'compute', eventOpen: true }))), 'none');
  });

  it('refuses everything outside the season', () => {
    assert.equal(refusal(() => assertCanStart(context({ seasonOpen: false }))), 'season-closed');
  });
});

describe('checking a step', () => {
  it('holds a walk to the time the trip needs', () => {
    // streetLamp: step 0 has no earlier stop, step 1 is a trip from (18, 18) to (25, 16), nine cells.
    assert.equal(refusal(() => checkStep(lamp, 0, { kind: 'goto' }, MIN_STEP_MS - 1)), 'too-fast');
    assert.equal(refusal(() => checkStep(lamp, 0, { kind: 'goto' }, MIN_STEP_MS)), 'none');
    const needed = 9 * MIN_MS_PER_CELL;
    assert.equal(refusal(() => checkStep(lamp, 1, { kind: 'goto' }, needed - 1)), 'too-fast');
    assert.equal(refusal(() => checkStep(lamp, 1, { kind: 'goto' }, needed)), 'none');
  });

  it('checks the answer of a talk step', () => {
    const lights = findMission('lightsOut')!;
    assert.equal(refusal(() => checkStep(lights, 1, { kind: 'talk', answer: 0 }, 5_000)), 'wrong-answer');
    assert.equal(refusal(() => checkStep(lights, 1, { kind: 'talk', answer: 7 }, 5_000)), 'wrong-answer');
    assert.equal(refusal(() => checkStep(lights, 1, { kind: 'talk', answer: 1 }, 5_000)), 'none');
  });

  it('checks the order of a puzzle', () => {
    assert.equal(refusal(() => checkStep(lamp, 2, { kind: 'puzzle', order: [1, 0, 2, 3] }, 5_000)), 'wrong-order');
    assert.equal(refusal(() => checkStep(lamp, 2, { kind: 'puzzle', order: [0, 1, 2] }, 5_000)), 'wrong-order');
    assert.equal(refusal(() => checkStep(lamp, 2, { kind: 'puzzle', order: [0, 1, 2, 3] }, 5_000)), 'none');
  });

  it('refuses a proof for another kind of step and a step past the end', () => {
    assert.equal(refusal(() => checkStep(lamp, 2, { kind: 'goto' }, 5_000)), 'wrong-step');
    assert.equal(refusal(() => checkStep(lamp, 9, { kind: 'goto' }, 5_000)), 'wrong-step');
  });
});

describe('reading a proof', () => {
  it('accepts the three shapes and nothing else', () => {
    assert.deepEqual(parseProof({ kind: 'goto' }), { kind: 'goto' });
    assert.deepEqual(parseProof({ kind: 'talk', answer: 2 }), { kind: 'talk', answer: 2 });
    assert.deepEqual(parseProof({ kind: 'puzzle', order: [0, 1] }), { kind: 'puzzle', order: [0, 1] });
    for (const bad of [null, 'goto', { kind: 'talk' }, { kind: 'talk', answer: 1.5 }, { kind: 'puzzle', order: 'x' }, { kind: 'puzzle', order: Array(40).fill(0) }, { kind: 'fly' }]) {
      assert.equal(parseProof(bad), undefined);
    }
  });
});
