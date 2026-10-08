import type { ROLE_TEMPLATES } from './constants.js';

/**
 * Trainable citizen stat, internal name.
 *
 * SPEC v2 §7 and §9: the internal identifier is `compute`, and the *public*
 * label shown to a citizen is **Craft**. The three public labels are Insight,
 * Bond and Craft, and the display side owns that mapping (`STAT_LABELS`); no
 * internal name is ever rendered as UI copy.
 */
export type StatType = 'intelligence' | 'alignment' | 'compute';

export const STAT_TYPES: readonly StatType[] = ['intelligence', 'alignment', 'compute'];

export function isStatType(value: unknown): value is StatType {
  return typeof value === 'string' && (STAT_TYPES as readonly string[]).includes(value);
}

/**
 * Public label of each stat (SPEC v2 §7).
 *
 * These are the words a citizen sees. The internal names stay in code so that
 * the on-chain account fields, the content records and the UI all agree on one
 * identifier each — only the rendering layer translates.
 */
export const STAT_LABELS: Readonly<Record<StatType, string>> = {
  intelligence: 'Insight',
  alignment: 'Bond',
  compute: 'Craft',
} as const;

/**
 * Phase A role (SPEC v2 §6.5).
 *
 * The role is chosen at registration and determines the starting stats, which
 * the program derives from its own registry — never from caller input, because
 * caller-supplied stats would let anyone self-register at 10/10/10 without
 * burning a single token.
 */
export type RoleTemplate = (typeof ROLE_TEMPLATES)[number];

export type RoleKey = RoleTemplate['key'];

/** On-chain representation of a role: its registry index. */
export type RoleIndex = RoleTemplate['index'];

/** Program-owned immutable URI registry for an approved Core metadata template. */
export interface ApprovedTemplateOnChain {
  /** Layout version. */
  version: number;
  /** PDA bump. */
  bump: number;
  /** Registry index expected by DistrictConfig. */
  templateId: number;
  /** Immutable HTTPS prefix against which Core asset URIs are checked. */
  uriPrefix: string;
}

/**
 * Canonical citizen progression state as stored by the District program.
 *
 * Mirrors `CitizenState` in `programs/district/src/state.rs` (SPEC v2 §6.4).
 * It is the on-chain record, so it carries the protocol's internal names and
 * its byte-order fields; it is deliberately *not* shaped like a UI view model.
 */
export interface CitizenStateOnChain {
  /** Schema version, so a later migration can tell old records apart. */
  version: number;
  /** PDA bump, stored because re-deriving it costs compute on every call. */
  bump: number;
  /** 1-based registration number. 0 means unregistered. */
  citizenId: number;
  /** The MPL Core asset this record belongs to. */
  asset: string;
  /** Registry index of the chosen role. */
  role: RoleIndex;
  intelligence: number;
  alignment: number;
  compute: number;
  /**
   * Three separate pools, not one shared balance (§5.3).
   *
   * A credit claimed for Insight cannot pay for a Craft upgrade. Sharing one
   * pool would let a citizen bank cheap missions and spend them on whatever
   * stat they liked, which is exactly what the per-stat grant is meant to
   * prevent.
   */
  insightTrainingCredits: number;
  bondTrainingCredits: number;
  craftTrainingCredits: number;
}

/**
 * Receipt returned after one atomic training transaction (SPEC v2 §17).
 *
 * Named after what it reports: the transaction raised one score and burned the
 * tokens it cost. Nothing is minted and nothing is transferred to a wallet.
 */
export interface ScoreUpgradeReceipt {
  signature: string;
  statUpgraded: StatType;
  newScore: number;
  /** Tokens destroyed, in atoms. Equals `baseTrainingCost * (oldScore + 1)`. */
  tokensBurned: number;
  timestamp: number;
}

/** Receipt returned after one successful citizen mint. */
export interface MintResult {
  signature: string;
  assetAddress: string;
  citizenId: number;
}
