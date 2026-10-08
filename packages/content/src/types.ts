/**
 * Domain constants of the authored content.
 * Browser-safe: this module must never import Node built-ins.
 */

/** Content language directories under `content/`. Only English exists today. */
export type ContentLocale = 'en';

/** Maximum score of a single citizen stat, mirrored by `programs/district`. */
export const MAX_STAT_SCORE = 20;

/** Trainable citizen attributes, in display order. */
export const STAT_KEYS = ['intelligence', 'alignment', 'composure'] as const;

/** Trainable citizen attribute. */
export type StatKey = (typeof STAT_KEYS)[number];

/** Canonical citizen record as authored in `content/en/citizens.json`. */
export interface CitizenRecord {
  id: number;
  name: string;
  code: string;
  role: string;
  roleKey: string;
  /** Public path of the full-body sprite, e.g. `/characters/1.png`. */
  image: string;
  /** Public path of the small portrait used in lists, e.g. `/avatars/1.png`. */
  avatar: string;
  intelligence: number;
  alignment: number;
  composure: number;
  registered: boolean;
  lore: string;
}
