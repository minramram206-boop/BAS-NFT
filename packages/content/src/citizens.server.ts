import 'server-only';

import { loadRepoJson } from '@bas/config';
import { getCitizenRoles } from './roles.server.js';
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

export { getCitizenRole, getCitizenRoles, ROLES_CONTENT_FILE } from './roles.server.js';

let cache: readonly CitizenRecord[] | null = null;

/**
 * Load and validate `content/en/citizens.json`. Cached per process.
 *
 * The file stores the starting mock roster, so its scores must agree with the
 * selected role template. Live progression belongs in the on-chain
 * `CitizenState`, not in this authored file.
 */
export function getCitizens(): readonly CitizenRecord[] {
  if (cache) return cache;
  const roles = getCitizenRoles();
  const citizens = parseCitizenRoster(loadRepoJson<unknown>(CITIZENS_CONTENT_FILE));
  for (const [index, citizen] of citizens.entries()) {
    const role = roles.find((entry) => entry.key === citizen.roleKey);
    if (!role) {
      throw new Error(`[@bas/content] citizen #${citizen.id} refers to unknown role ${citizen.roleKey}`);
    }
    for (const stat of ['intelligence', 'alignment', 'compute'] as const) {
      if (citizen[stat] !== role.initialStats[stat]) {
        throw new Error(
          `[@bas/content] citizen at index ${index} has ${stat}=${citizen[stat]}, ` +
            `but role ${citizen.roleKey} starts at ${role.initialStats[stat]}`,
        );
      }
    }
  }
  cache = citizens;
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
