/**
 * Domain types and constants of the authored English content.
 * Browser-safe: this module must never import Node built-ins.
 */

/** Content language directories under `content/`. Only English exists today. */
export type ContentLocale = 'en';

/**
 * Maximum citizen stat score, mirrored by `STAT_MAX` in the Anchor program.
 *
 * SPEC v2 §7: the previous repository value of 20 did not match the approved
 * maximum of 10 and has been corrected.
 */
export const MAX_STAT_SCORE = 10;

/** Trainable stat fields, in display order; these are internal identifiers. */
export const STAT_KEYS = ['intelligence', 'alignment', 'compute'] as const;

/** Internal name of a trainable attribute. Public UI labels are in English. */
export type StatKey = (typeof STAT_KEYS)[number];

/** Stable keys of the seven Phase A roles in `content/en/roles.json`. */
export const ROLE_KEYS = [
  'pioneer',
  'steward',
  'artisan',
  'sentinel',
  'scholar',
  'navigator',
  'mentor',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/** Public display labels of the roles in `content/en/roles.json`. */
export const ROLE_LABELS = [
  'Pioneer',
  'Steward',
  'Artisan',
  'Sentinel',
  'Scholar',
  'Navigator',
  'Mentor',
] as const;

export type RoleLabel = (typeof ROLE_LABELS)[number];

/** Numeric role index stored in the on-chain `CitizenState.role` field. */
export type RoleIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The starting score spread of one role, in internal field names. */
export interface RoleStartingStats {
  intelligence: number;
  alignment: number;
  compute: number;
}

/** Canonical role registry entry from `content/en/roles.json`. */
export interface CitizenRoleRecord {
  index: RoleIndex;
  key: RoleKey;
  label: RoleLabel;
  initialStats: RoleStartingStats;
}

/** Canonical citizen record as authored in `content/en/citizens.json`. */
export interface CitizenRecord {
  id: number;
  name: string;
  code: string;
  /** Public English role label; must match the role registry entry. */
  role: RoleLabel;
  /** Stable internal role key, matched with the program's registry. */
  roleKey: RoleKey;
  /** Public path of the full-body sprite, e.g. `/characters/1.png`. */
  image: string;
  /** Public path of the portrait used in lists, e.g. `/avatars/1.png`. */
  avatar: string;
  intelligence: number;
  alignment: number;
  compute: number;
  registered: boolean;
  lore: string;
}
