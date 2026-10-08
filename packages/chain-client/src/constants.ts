/**
 * Protocol constants shared by the on-chain program and its clients.
 *
 * Every value here mirrors `programs/district/src`, and `packages/chain-client/test`
 * fails when the two drift apart. Nothing in this file is a second source of
 * truth: the program is, and these constants exist so a client cannot quietly
 * disagree with it.
 */

/**
 * Maximum score of a single citizen stat (SPEC v2 §7).
 *
 * Mirrors `STAT_MAX` in `programs/district/src/state.rs`. This is 10, not 20:
 * a score of 10 is the top of Tier 3 and cannot be raised further.
 */
export const STAT_MAX = 10;

/** Tier 1 starts here (SPEC v2 §7). */
export const TIER_1_SCORE = 3;

/** Tier 2 starts here (SPEC v2 §7). */
export const TIER_2_SCORE = 6;

/**
 * Tier 3 starts here (SPEC v2 §7).
 *
 * Tier 3 has no visual change and is reached only through Training Credits,
 * which exist only as the reward for authorized missions — so it is unreachable
 * by spending tokens. That is the point of the tier.
 */
export const TIER_3_SCORE = 10;

/**
 * Training Credits granted by one accepted mission claim.
 *
 * Mirrors `CREDITS_PER_UPGRADE` in `state.rs`. One credit raises one stat by
 * exactly one level.
 */
export const CREDITS_PER_UPGRADE = 1;

/**
 * Number of roles in the Phase A registry (SPEC v2 §6.5).
 *
 * Mirrors `ROLE_COUNT` in `programs/district/src/roles.rs`. Phase B extends the
 * registry, and every role in this list is still valid afterwards.
 */
export const ROLE_COUNT = 7;

/** Version stamped into `DistrictConfig` (SPEC v2 §6.4). */
export const DISTRICT_CONFIG_VERSION = 1;

/** Version stamped into `CitizenState` (SPEC v2 §6.4). */
export const CITIZEN_STATE_VERSION = 1;

/** Version stamped into `ClaimReceipt` (SPEC v2 §6.4). */
export const CLAIM_RECEIPT_VERSION = 1;

/** Maximum number of credits a single pool can hold. */
export const TRAINING_CREDITS_MAX = 65_535;

/**
 * Metaplex Core program address.
 *
 * Mirrored by `MPL_CORE_PROGRAM_ID` in `programs/district/src/mpl_core.rs`;
 * `packages/chain-client/test` fails when the two drift apart. Callers pass
 * this program as the `mpl_core_program` account of `register_citizen`, and the
 * program uses it to verify that the asset account really was written by
 * Metaplex Core.
 */
export const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';

/** Byte layout of a Core `AssetV1` account, mirrored by `mpl_core.rs`. */
export const CORE_ASSET_LAYOUT = {
  /** `Key::AssetV1` discriminator. */
  keyAssetV1: 1,
  /** `UpdateAuthority::Collection` variant tag. */
  updateAuthorityCollection: 2,
  ownerOffset: 1,
  updateAuthorityTagOffset: 33,
  collectionOffset: 34,
  minPrefixLength: 66,
} as const;

/**
 * PDA seeds used by `programs/district/src/lib.rs`.
 *
 * `citizen` — not `citizen_state`: the seed is part of the address, so a client
 * that derives it with a different string asks for an account that does not
 * exist. SPEC v2 §6.4 fixes these.
 */
export const PROGRAM_SEEDS = {
  districtConfig: 'district_config',
  citizen: 'citizen',
  claim: 'claim',
  approvedTemplate: 'approved_template',
} as const;

/**
 * Starting stats of the Phase A role registry (SPEC v2 §6.5).
 *
 * Mirrors `ROLES` in `programs/district/src/roles.rs`; the parity test parses
 * that table directly, so adding a role in Rust without adding it here fails CI.
 *
 * Every role starts with the same total of 3 points spread differently, and
 * none of them starts at Tier 1. That matters for the economy in §5.3: a role
 * that started at 3 would already own its first tier before burning anything.
 */
export const ROLE_TEMPLATES = [
  { index: 0, key: 'pioneer', label: 'Pioneer', intelligence: 1, alignment: 1, compute: 1 },
  { index: 1, key: 'steward', label: 'Steward', intelligence: 1, alignment: 2, compute: 0 },
  { index: 2, key: 'artisan', label: 'Artisan', intelligence: 0, alignment: 1, compute: 2 },
  { index: 3, key: 'sentinel', label: 'Sentinel', intelligence: 0, alignment: 2, compute: 1 },
  { index: 4, key: 'scholar', label: 'Scholar', intelligence: 2, alignment: 1, compute: 0 },
  { index: 5, key: 'navigator', label: 'Navigator', intelligence: 2, alignment: 0, compute: 1 },
  { index: 6, key: 'mentor', label: 'Mentor', intelligence: 1, alignment: 0, compute: 2 },
] as const satisfies ReadonlyArray<{
  index: number;
  key: string;
  label: string;
  intelligence: number;
  alignment: number;
  compute: number;
}>;
