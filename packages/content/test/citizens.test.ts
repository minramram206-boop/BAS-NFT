import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import {
  CITIZENS_CONTENT_FILE,
  MAX_STAT_SCORE,
  STAT_KEYS,
  getCitizenById,
  getCitizens,
  getDefaultCitizenId,
  loadCitizens,
} from '../src/index.ts';
import type { CitizenRecord } from '../src/types.ts';

const repoRoot = findRepoRoot();
const publicDir = join(repoRoot, 'apps/web/public');

function assertValidCitizen(citizen: CitizenRecord): void {
  assert.ok(Number.isInteger(citizen.id) && citizen.id > 0, 'id must be a positive integer');
  assert.ok(citizen.name.length > 0, 'name must not be empty');
  assert.ok(citizen.code.startsWith('#'), 'code must be a #NNN tag');
  assert.ok(citizen.avatar.startsWith('/avatars/'), 'avatar must be a public path');
  assert.ok(citizen.image.startsWith('/characters/'), 'image must be a public path');
  for (const stat of STAT_KEYS) {
    assert.ok(citizen[stat] >= 0 && citizen[stat] <= MAX_STAT_SCORE, `${stat} within range`);
  }
}

describe('@bas/content', () => {
  it('loads the mandated content file', () => {
    assert.equal(CITIZENS_CONTENT_FILE, 'content/en/citizens.json');
    assert.ok(existsSync(join(repoRoot, CITIZENS_CONTENT_FILE)));
  });

  it('returns a frozen, validated roster', () => {
    const citizens = getCitizens();
    assert.equal(citizens.length, 20);
    assert.ok(Object.isFrozen(citizens));
    assert.equal(getCitizens(), citizens, 'the roster is cached');
    citizens.forEach(assertValidCitizen);

    const ids = citizens.map((citizen) => citizen.id);
    assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  });

  it('only references sprites that exist in apps/web/public', () => {
    for (const citizen of getCitizens()) {
      for (const asset of [citizen.image, citizen.avatar]) {
        assert.ok(existsSync(join(publicDir, asset)), `missing public asset ${asset}`);
      }
    }
  });

  it('hands out a mutable copy so stores never mutate shared content', () => {
    const copy = loadCitizens();
    const first = copy[0];
    assert.ok(first, 'copy must not be empty');

    first.intelligence = MAX_STAT_SCORE;
    first.name = 'mutated';

    const cached = getCitizenById(first.id);
    assert.ok(cached, 'cached citizen must still exist');
    assert.notEqual(cached.name, 'mutated');
    assert.notEqual(cached.intelligence, MAX_STAT_SCORE);
    assert.notEqual(loadCitizens()[0], first);
  });

  it('exposes lookups used by the web app', () => {
    const defaultId = getDefaultCitizenId();
    assert.equal(defaultId, getCitizens()[0]?.id);
    assert.equal(getCitizenById(defaultId)?.id, defaultId);
    assert.equal(getCitizenById(-1), undefined);
  });
});
