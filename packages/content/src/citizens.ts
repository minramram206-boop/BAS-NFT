import { loadRepoJson } from '@bas/config';
import type { CitizenRecord, StatKey } from './types.ts';

/** Canonical citizen roster, mandated by `docs/id/TECH_STACK_ID.md` section 11. */
export const CITIZENS_CONTENT_FILE = 'content/en/citizens.json';

/** Every citizen stat starts at 0 and is capped by the on-chain program. */
export const MAX_STAT_SCORE = 20;

export const STAT_KEYS: readonly StatKey[] = ['intelligence', 'alignment', 'composure'];

const STRING_FIELDS = ['name', 'code', 'role', 'roleKey', 'image', 'avatar', 'lore'] as const;

function invalid(index: number, field: string, reason: string): never {
  throw new Error(`[@bas/content] invalid citizen at index ${index}, field "${field}": ${reason}`);
}

function validateScore(value: unknown, index: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    invalid(index, field, 'expected an integer');
  }
  if (value < 0 || value > MAX_STAT_SCORE) {
    invalid(index, field, `expected a score between 0 and ${MAX_STAT_SCORE}`);
  }
  return value;
}

function validateCitizen(raw: unknown, index: number): CitizenRecord {
  if (typeof raw !== 'object' || raw === null) {
    invalid(index, '(root)', 'expected an object');
  }

  const source = raw as Record<string, unknown>;

  if (typeof source.id !== 'number' || !Number.isInteger(source.id)) {
    invalid(index, 'id', 'expected an integer');
  }
  for (const field of STRING_FIELDS) {
    const value = source[field];
    if (typeof value !== 'string' || value.length === 0) {
      invalid(index, field, 'expected a non-empty string');
    }
  }
  if (typeof source.registered !== 'boolean') {
    invalid(index, 'registered', 'expected a boolean');
  }

  return {
    id: source.id,
    name: source.name as string,
    code: source.code as string,
    role: source.role as string,
    roleKey: source.roleKey as string,
    image: source.image as string,
    avatar: source.avatar as string,
    intelligence: validateScore(source.intelligence, index, 'intelligence'),
    alignment: validateScore(source.alignment, index, 'alignment'),
    composure: validateScore(source.composure, index, 'composure'),
    registered: source.registered,
    lore: source.lore as string,
  };
}

let cache: readonly CitizenRecord[] | null = null;

/**
 * Load and validate `content/en/citizens.json`.
 *
 * The result is frozen and cached. Callers that need to mutate a roster must
 * copy it first (see `loadCitizens`), so shared content data is never changed
 * in place by application state.
 */
export function getCitizens(): readonly CitizenRecord[] {
  if (cache) return cache;

  const raw = loadRepoJson<unknown>(CITIZENS_CONTENT_FILE);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`[@bas/content] ${CITIZENS_CONTENT_FILE} must be a non-empty array`);
  }

  const citizens = raw.map(validateCitizen);
  const ids = new Set(citizens.map((citizen) => citizen.id));
  if (ids.size !== citizens.length) {
    throw new Error(`[@bas/content] ${CITIZENS_CONTENT_FILE} contains duplicate citizen ids`);
  }

  cache = Object.freeze(citizens);
  return cache;
}

/**
 * Return a mutable deep copy of the roster for use as initial application state.
 * Copying keeps store updates from writing into the shared content module.
 */
export function loadCitizens(): CitizenRecord[] {
  return getCitizens().map((citizen) => ({ ...citizen }));
}

export function getCitizenById(id: number): CitizenRecord | undefined {
  return getCitizens().find((citizen) => citizen.id === id);
}

/** Citizen selected on first load when no wallet-owned citizen is known yet. */
export function getDefaultCitizenId(): number {
  const citizens = getCitizens();
  return citizens[0]?.id ?? 0;
}
