import 'server-only';

import { loadRepoJson } from '@bas/config';
import { parseRoleRoster } from './validate.js';
import type { CitizenRoleRecord } from './types.js';

/** Canonical seven-role registry, mandated by `TECH_STACK_ID.md` §11. */
export const ROLES_CONTENT_FILE = 'content/en/roles.json';

let cache: readonly CitizenRoleRecord[] | null = null;

/** Load and validate `content/en/roles.json`. Cached per process. */
export function getCitizenRoles(): readonly CitizenRoleRecord[] {
  if (cache) return cache;
  cache = parseRoleRoster(loadRepoJson<unknown>(ROLES_CONTENT_FILE));
  return cache;
}

/** Look up one role by the stable key used by citizen records. */
export function getCitizenRole(key: CitizenRoleRecord['key']): CitizenRoleRecord | undefined {
  return getCitizenRoles().find((role) => role.key === key);
}
