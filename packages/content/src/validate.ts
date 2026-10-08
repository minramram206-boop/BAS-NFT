import { MAX_STAT_SCORE } from './types.js';
import type { CitizenRecord } from './types.js';

/**
 * Content validation shared by the server loader and the tests.
 * Browser-safe: it only inspects data and never touches the file system.
 */

const STRING_FIELDS = ['name', 'code', 'role', 'roleKey', 'image', 'avatar', 'lore'] as const;

export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

function invalid(index: number, field: string, reason: string): never {
  throw new ContentValidationError(`invalid citizen at index ${index}, field "${field}": ${reason}`);
}

function requireInteger(value: unknown, index: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    invalid(index, field, 'expected an integer');
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
  if (typeof value !== 'string' || value.length === 0) {
    invalid(index, field, 'expected a non-empty string');
  }
  return value;
}

/** Validate and narrow one raw roster entry. */
export function parseCitizen(raw: unknown, index: number): CitizenRecord {
  if (typeof raw !== 'object' || raw === null) {
    invalid(index, '(root)', 'expected an object');
  }

  const source = raw as Record<string, unknown>;

  requireInteger(source.id, index, 'id');
  for (const field of STRING_FIELDS) {
    requireString(source[field], index, field);
  }
  if (typeof source.registered !== 'boolean') {
    invalid(index, 'registered', 'expected a boolean');
  }

  return {
    id: source.id as number,
    name: source.name as string,
    code: source.code as string,
    role: source.role as string,
    roleKey: source.roleKey as string,
    image: source.image as string,
    avatar: source.avatar as string,
    intelligence: requireScore(source.intelligence, index, 'intelligence'),
    alignment: requireScore(source.alignment, index, 'alignment'),
    composure: requireScore(source.composure, index, 'composure'),
    registered: source.registered,
    lore: source.lore as string,
  };
}

/**
 * Validate a whole roster: non-empty array, valid records, unique ids.
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
