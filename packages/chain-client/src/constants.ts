/**
 * Protocol constants mirrored from `programs/district/src`. The program is the
 * source of truth; `test/chain-client.test.ts` fails when the two drift apart.
 */

/** Maximum score of a single stat (SPEC v2 §7). Mirrors `STAT_MAX` in `constants.rs`. */
export const STAT_MAX = 10;

/** Tier 1 starts here (SPEC v2 §7). */
export const TIER_1_SCORE = 3;

/** Tier 2 starts here (SPEC v2 §7). */
export const TIER_2_SCORE = 6;

/** Tier 3 starts here (SPEC v2 §7). */
export const TIER_3_SCORE = 10;

/** Credits granted per claim and consumed per upgrade. Mirrors `CREDITS_PER_UPGRADE`. */
export const CREDITS_PER_UPGRADE = 1;

/** Roles in the Phase A registry. Mirrors `ROLE_COUNT` in `roles.rs`. */
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
 * Metaplex Core program address. The district program requires every citizen
 * asset account to be owned by exactly this id (`mpl_core.rs`).
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

/** PDA seeds from `programs/district/src/constants.rs` (SPEC v2 §6.4). */
export const PROGRAM_SEEDS = {
  districtConfig: 'district_config',
  citizen: 'citizen',
  claim: 'claim',
  approvedTemplate: 'approved_template',
} as const;

/**
 * Starting stats of the role registry. Mirrors `ROLE_TEMPLATES` in `roles.rs`,
 * which the parity test parses directly. Every role starts with 3 points and
 * below Tier 1.
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

/** Core Candy Machine program, which holds the sale's supply and mint order. */
export const CORE_CANDY_MACHINE_PROGRAM_ID = 'CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J';

/** Core Candy Guard program, which enforces payment, the mint limit and the backend signer. */
export const CORE_CANDY_GUARD_PROGRAM_ID = 'CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ';

/**
 * Id of the `mintLimit` guard of the public sale. The counter PDAs that say how
 * many citizens a wallet has minted are derived from it, so the setup script,
 * the mission server and the web app all use this one number.
 */
export const MINT_LIMIT_ID = 0;

/** Byte layout of a Core `CandyMachine` account (`candy-machine-core/.../state/candy_machine.rs`). */
export const CANDY_MACHINE_LAYOUT = {
  /** First 8 bytes of `sha256("account:CandyMachine")`. */
  discriminator: Uint8Array.of(51, 173, 177, 113, 25, 241, 109, 189),
  authorityOffset: 8,
  mintAuthorityOffset: 40,
  collectionOffset: 72,
  itemsRedeemedOffset: 104,
  /** `CandyMachineData` starts here and opens with `itemsAvailable` (u64). */
  itemsAvailableOffset: 112,
  minLength: 120,
} as const;
