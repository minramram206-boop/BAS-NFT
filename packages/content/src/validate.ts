import {
  MAX_STAT_SCORE,
  ROLE_KEYS,
  ROLE_LABELS,
  STAT_KEYS,
} from './types.js';
import type {
  CitizenRecord,
  CitizenRoleRecord,
  RoleIndex,
  RoleKey,
  RoleLabel,
  RoleStartingStats,
} from './types.js';

/**
 * Content validation shared by the server loader and tests.
 * Browser-safe: it only inspects data and never touches the file system.
 */

const STRING_FIELDS = ['name', 'code', 'image', 'avatar', 'lore'] as const;

export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

function invalid(index: number, field: string, reason: string): never {
  throw new ContentValidationError(`invalid content at index ${index}, field "${field}": ${reason}`);
}

function requireInteger(value: unknown, index: number, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    invalid(index, field, 'expected a safe integer');
  }
  return value;
}

function requireScore(value: unknown, index: number, field: string): number {
  const score = requireInteger(value, index, field);
  if (score < 0 || score > MAX_STAT_SCORE) {
    invalid(index, field, `expected a score between 0 and ${MAX_STAT_SCORE}`);
  }
  return score;
}

function requireString(value: unknown, index: number, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(index, field, 'expected a non-empty string');
  }
  return value;
}

function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

function isRoleLabel(value: string): value is RoleLabel {
  return (ROLE_LABELS as readonly string[]).includes(value);
}

function expectedRoleLabel(key: RoleKey): RoleLabel {
  const index = ROLE_KEYS.indexOf(key);
  return ROLE_LABELS[index] as RoleLabel;
}

/** Validate and narrow one raw citizen entry. */
export function parseCitizen(raw: unknown, index: number): CitizenRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    invalid(index, '(root)', 'expected an object');
  }

  const source = raw as Record<string, unknown>;
  const id = requireInteger(source.id, index, 'id');
  if (id <= 0) invalid(index, 'id', 'expected a positive integer');

  for (const field of STRING_FIELDS) {
    requireString(source[field], index, field);
  }

  const roleKeyText = requireString(source.roleKey, index, 'roleKey');
  if (!isRoleKey(roleKeyText)) {
    invalid(index, 'roleKey', `expected one of ${ROLE_KEYS.join(', ')}`);
  }
  const roleText = requireString(source.role, index, 'role');
  if (!isRoleLabel(roleText)) {
    invalid(index, 'role', `expected one of ${ROLE_LABELS.join(', ')}`);
  }
  if (roleText !== expectedRoleLabel(roleKeyText)) {
    invalid(index, 'role', `must be "${expectedRoleLabel(roleKeyText)}" for roleKey "${roleKeyText}"`);
  }
  if (typeof source.registered !== 'boolean') {
    invalid(index, 'registered', 'expected a boolean');
  }

  return {
    id,
    name: source.name as string,
    code: source.code as string,
    role: roleText,
    roleKey: roleKeyText,
    image: source.image as string,
    avatar: source.avatar as string,
    intelligence: requireScore(source.intelligence, index, 'intelligence'),
    alignment: requireScore(source.alignment, index, 'alignment'),
    compute: requireScore(source.compute, index, 'compute'),
    registered: source.registered,
    lore: source.lore as string,
  };
}

/**
 * Validate the canonical seven-role registry (`content/en/roles.json`).
 *
 * It is the data source consumed by server loaders and test fixtures; Rust and
 * the client package keep typed mirrors, each checked against this file in CI.
 */
export function parseRoleRoster(raw: unknown): readonly CitizenRoleRecord[] {
  if (!Array.isArray(raw) || raw.length !== ROLE_KEYS.length) {
    throw new ContentValidationError(`role content must contain exactly ${ROLE_KEYS.length} entries`);
  }

  const roles = raw.map((item: unknown, position: number): CitizenRoleRecord => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      invalid(position, '(root)', 'expected a role object');
    }
    const source = item as Record<string, unknown>;
    const index = requireInteger(source.index, position, 'index');
    if (index !== position || index < 0 || index >= ROLE_KEYS.length) {
      invalid(position, 'index', `expected dense zero-based index ${position}`);
    }

    const keyText = requireString(source.key, position, 'key');
    if (!isRoleKey(keyText) || keyText !== ROLE_KEYS[position]) {
      invalid(position, 'key', `expected "${ROLE_KEYS[position]}"`);
    }
    const labelText = requireString(source.label, position, 'label');
    if (!isRoleLabel(labelText) || labelText !== ROLE_LABELS[position]) {
      invalid(position, 'label', `expected "${ROLE_LABELS[position]}"`);
    }

    const rawStats = source.initialStats;
    if (typeof rawStats !== 'object' || rawStats === null || Array.isArray(rawStats)) {
      invalid(position, 'initialStats', 'expected an object');
    }
    const statsSource = rawStats as Record<string, unknown>;
    const initialStats: RoleStartingStats = {
      intelligence: requireScore(statsSource.intelligence, position, 'initialStats.intelligence'),
      alignment: requireScore(statsSource.alignment, position, 'initialStats.alignment'),
      compute: requireScore(statsSource.compute, position, 'initialStats.compute'),
    };
    const total = initialStats.intelligence + initialStats.alignment + initialStats.compute;
    if (total !== 3) {
      invalid(position, 'initialStats', `expected three starting points in total; received ${total}`);
    }
    if (Math.max(...STAT_KEYS.map((key) => initialStats[key])) >= 3) {
      invalid(position, 'initialStats', 'a role must start below Tier 1');
    }

    return Object.freeze({
      index: index as RoleIndex,
      key: keyText,
      label: labelText,
      initialStats: Object.freeze(initialStats),
    });
  });

  return Object.freeze(roles);
}

/**
 * Validate a whole citizen roster: non-empty array, valid records, unique ids.
 * Returns a frozen array so callers cannot mutate shared content data.
 */
export function parseCitizenRoster(raw: unknown): readonly CitizenRecord[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ContentValidationError('citizen content must be a non-empty array');
  }

  const citizens = raw.map(parseCitizen);
  const ids = new Set(citizens.map((citizen) => citizen.id));
  if (ids.size !== citizens.length) {
    throw new ContentValidationError('citizen content contains duplicate ids');
  }

  return Object.freeze(citizens);
}
