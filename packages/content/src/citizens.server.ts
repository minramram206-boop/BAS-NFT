import 'server-only';

import { loadRepoJson } from '@bas/config';
import { parseCitizenRoster } from './validate.js';
import type { CitizenRecord } from './types.js';

/**
 * Server-only content loaders.
 *
 * Importing this module from a Client Component fails the build on purpose:
 * it reads the repository file system, which must never reach the browser
 * bundle. Client code receives already validated data through props.
 */

/** Canonical citizen roster, mandated by `docs/id/TECH_STACK_ID.md` section 11. */
export const CITIZENS_CONTENT_FILE = 'content/en/citizens.json';

let cache: readonly CitizenRecord[] | null = null;

/** Load and validate `content/en/citizens.json`. Cached per process. */
export function getCitizens(): readonly CitizenRecord[] {
  if (cache) return cache;
  cache = parseCitizenRoster(loadRepoJson<unknown>(CITIZENS_CONTENT_FILE));
  return cache;
}

/** Mutable deep copy of the roster, safe to hand to client state. */
export function loadCitizens(): CitizenRecord[] {
  return getCitizens().map((citizen) => ({ ...citizen }));
}

export function getCitizenById(id: number): CitizenRecord | undefined {
  return getCitizens().find((citizen) => citizen.id === id);
}

/** Citizen selected on first render when no wallet-owned citizen is known yet. */
export function getDefaultCitizenId(): number {
  return getCitizens()[0]?.id ?? 0;
}
