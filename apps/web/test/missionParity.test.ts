import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DAILY_MISSION_LIMIT,
  DISTRICT_UNLOCK,
  EVENT_TASK_POINTS as SERVER_EVENT_POINTS,
  MISSIONS,
  MISSION_POINTS as SERVER_MISSION_POINTS,
} from '../../mission-server/src/catalog.ts';
import { DISTRICT_RULES } from '../src/lib/data/districts.ts';
import { DAILY_MISSION_CREDITS, EVENT_TASK_POINTS, MISSION_POINTS } from '../src/lib/data/missions.ts';
import { MOCK_ANSWERS, MOCK_MISSIONS } from '../src/lib/data/mock/mockSnapshot.ts';

const messages = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/messages/en.json'), 'utf8')) as {
  missions: { catalog: Record<string, { steps: readonly { options?: readonly string[]; pieces?: readonly string[] }[] }> };
};

/**
 * The mission server enforces the catalog; the web preview plays the same
 * missions from mock data. These checks keep the two from drifting apart.
 */
describe('mission server catalog', () => {
  it('lists the same missions as the web catalog, in the same order', () => {
    assert.deepEqual(
      MISSIONS.map((mission) => mission.id),
      MOCK_MISSIONS.map((mission) => mission.id),
    );
  });

  it('agrees on district, rewarded stats, steps and event status', () => {
    for (const mission of MISSIONS) {
      const web = MOCK_MISSIONS.find((item) => item.id === mission.id);
      assert.ok(web, mission.id);
      assert.equal(mission.district, web.district, `${mission.id} district`);
      assert.deepEqual([...mission.rewards], [...web.rewards], `${mission.id} rewards`);
      assert.equal(mission.event === true, web.event === true, `${mission.id} event`);
      assert.deepEqual(
        mission.steps.map((step) => step.kind),
        web.steps.map((step) => step.kind),
        `${mission.id} step kinds`,
      );
      mission.steps.forEach((step, index) => {
        const other = web.steps[index]!;
        if (step.kind === 'goto' && other.kind === 'goto') assert.deepEqual([...step.cell], [...other.cell], `${mission.id} step ${index}`);
        if (step.kind === 'talk') assert.equal(step.answer, MOCK_ANSWERS[mission.id]?.[index], `${mission.id} step ${index} answer`);
      });
    }
  });

  it('matches the number of replies and pieces the copy shows', () => {
    const catalog = messages.missions.catalog;
    for (const mission of MISSIONS) {
      mission.steps.forEach((step, index) => {
        const copy = catalog[mission.id]?.steps[index];
        assert.ok(copy, `${mission.id} step ${index} has copy`);
        if (step.kind === 'talk') assert.equal(copy.options?.length, step.options, `${mission.id} step ${index} options`);
        if (step.kind === 'puzzle') assert.equal(copy.pieces?.length, step.pieces, `${mission.id} step ${index} pieces`);
      });
    }
  });

  it('uses the same district unlock rules, daily limit and points', () => {
    for (const [id, rule] of Object.entries(DISTRICT_RULES)) {
      const server = DISTRICT_UNLOCK[id as keyof typeof DISTRICT_UNLOCK];
      assert.equal(server.score, rule.unlockScore, `${id} unlock score`);
      assert.deepEqual([...server.stats], [...rule.stats], `${id} stats`);
    }
    assert.equal(DAILY_MISSION_LIMIT, DAILY_MISSION_CREDITS);
    assert.equal(SERVER_MISSION_POINTS, MISSION_POINTS);
    assert.equal(SERVER_EVENT_POINTS, EVENT_TASK_POINTS);
  });
});
