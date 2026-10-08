import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import {
  ContentValidationError,
  MAX_STAT_SCORE,
  ROLE_KEYS,
  ROLE_LABELS,
  STAT_KEYS,
  parseCitizen,
  parseCitizenRoster,
  parseRoleRoster,
} from '../dist/index.js';
import {
  CITIZENS_CONTENT_FILE,
  ROLES_CONTENT_FILE,
  getCitizenById,
  getCitizenRole,
  getCitizenRoles,
  getCitizens,
  getDefaultCitizenId,
  loadCitizens,
} from '../dist/citizens.server.js';
import type { CitizenRecord } from '../dist/types.js';

const repoRoot = findRepoRoot();
const publicDir = join(repoRoot, 'apps/web/public');

function assertValidCitizen(citizen: CitizenRecord): void {
  assert.ok(Number.isInteger(citizen.id) && citizen.id > 0, 'id must be a positive integer');
  assert.ok(citizen.name.length > 0, 'name must not be empty');
  assert.ok(citizen.code.startsWith('#'), 'code must be a #NNN tag');
  assert.ok(citizen.avatar.startsWith('/avatars/'), 'avatar must be a public path');
  assert.ok(citizen.image.startsWith('/characters/'), 'image must be a public path');
  assert.ok(ROLE_KEYS.includes(citizen.roleKey));
  assert.ok(ROLE_LABELS.includes(citizen.role));
  for (const stat of STAT_KEYS) {
    assert.ok(citizen[stat] >= 0 && citizen[stat] <= MAX_STAT_SCORE, `${stat} within range`);
  }
}

describe('@bas/content server loaders', () => {
  it('loads the mandated English citizens and role registries', () => {
    assert.equal(CITIZENS_CONTENT_FILE, 'content/en/citizens.json');
    assert.equal(ROLES_CONTENT_FILE, 'content/en/roles.json');
    assert.ok(existsSync(join(repoRoot, CITIZENS_CONTENT_FILE)));
    assert.ok(existsSync(join(repoRoot, ROLES_CONTENT_FILE)));
  });

  it('returns a frozen, validated roster whose scores come from its role templates', () => {
    const citizens = getCitizens();
    assert.equal(citizens.length, 10, 'SPEC v2 Phase A: ten mock citizens');
    assert.ok(Object.isFrozen(citizens));
    assert.equal(getCitizens(), citizens, 'the roster is cached');
    citizens.forEach(assertValidCitizen);

    const roles = getCitizenRoles();
    assert.equal(roles.length, 7, 'SPEC v2 §8 Phase A: seven-role registry');
    assert.equal(new Set(roles.map((role) => role.key)).size, roles.length);
    assert.equal(new Set(citizens.map((citizen) => citizen.id)).size, citizens.length);
    assert.deepEqual(
      new Set(citizens.map((citizen) => citizen.roleKey)),
      new Set(roles.map((role) => role.key)),
      'all seven registry roles are represented by the mock roster',
    );

    for (const citizen of citizens) {
      const role = roles.find((item) => item.key === citizen.roleKey);
      assert.ok(role, `unknown role ${citizen.roleKey}`);
      assert.equal(citizen.role, role.label);
      assert.equal(citizen.intelligence, role.initialStats.intelligence);
      assert.equal(citizen.alignment, role.initialStats.alignment);
      assert.equal(citizen.compute, role.initialStats.compute);
    }
  });

  it('preserves the remaining authored citizens outside the ten-citizen Phase A preview', () => {
    const archivePath = join(repoRoot, 'content/en/citizens.archive.json');
    assert.ok(existsSync(archivePath));
    const archive = parseCitizenRoster(JSON.parse(readFileSync(archivePath, 'utf8')) as unknown);
    assert.equal(archive.length, 10);
    assert.equal(new Set(archive.map((citizen) => citizen.id)).size, archive.length);
    assert.ok(archive.every((citizen) => !getCitizens().some((active) => active.id === citizen.id)));
  });

  it('only references sprites that exist in apps/web/public', () => {
    for (const citizen of getCitizens()) {
      for (const asset of [citizen.image, citizen.avatar]) {
        assert.ok(existsSync(join(publicDir, asset)), `missing public asset ${asset}`);
      }
    }
  });

  it('hands out a mutable copy so client state never mutates shared content', () => {
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

  it('exposes role and citizen lookups used by the server routes', () => {
    const defaultId = getDefaultCitizenId();
    assert.equal(defaultId, getCitizens()[0]?.id);
    assert.equal(getCitizenById(defaultId)?.id, defaultId);
    assert.equal(getCitizenById(-1), undefined);
    assert.equal(getCitizenRole('pioneer')?.label, 'Pioneer');
    assert.equal(getCitizenRole('mentor')?.index, 6);
  });
});

describe('@bas/content validation', () => {
  const valid = {
    id: 1,
    name: 'Citizen One',
    code: '#001',
    role: 'Artisan',
    roleKey: 'artisan',
    image: '/characters/1.png',
    avatar: '/avatars/1.png',
    intelligence: 0,
    alignment: 1,
    compute: 2,
    registered: true,
    lore: 'A resourceful maker in District 01.',
  };

  it('accepts a well-formed citizen record', () => {
    assert.deepEqual(parseCitizen(valid, 0), valid);
  });

  it('rejects malformed citizen records', () => {
    assert.throws(() => parseCitizen(null, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, id: 1.5 }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, name: '' }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, registered: 'yes' }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, intelligence: MAX_STAT_SCORE + 1 }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, compute: -1 }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, roleKey: 'egg_farmer' }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, role: 'Egg Farmer' }, 0), ContentValidationError);
    assert.throws(() => parseCitizen({ ...valid, role: 'Pioneer' }, 0), /must be "Artisan"/);
  });

  it('rejects malformed citizen rosters', () => {
    assert.throws(() => parseCitizenRoster([]), ContentValidationError);
    assert.throws(() => parseCitizenRoster({}), ContentValidationError);
    assert.throws(() => parseCitizenRoster([valid, valid]), /duplicate ids/);
  });

  it('validates the role registry as seven dense, balanced templates', () => {
    const roles = getCitizenRoles();
    assert.equal(parseRoleRoster(roles).length, 7);
    assert.throws(() => parseRoleRoster([]), /exactly 7/);
    assert.throws(
      () => parseRoleRoster(roles.map((role, i) => (i === 0 ? { ...role, index: 1 } : role))),
      /dense zero-based index/,
    );
    assert.throws(
      () => parseRoleRoster(roles.map((role, i) => (i === 0 ? { ...role, key: 'wrong' } : role))),
      /expected "pioneer"/,
    );
    assert.throws(
      () => parseRoleRoster(roles.map((role, i) => (i === 0
        ? { ...role, initialStats: { intelligence: 10, alignment: 0, compute: 0 } }
        : role))),
      /three starting points/,
    );
  });
});
