/** Protocol constants shared by the on-chain program and its clients. */

/** Maximum score of a single citizen stat, mirrored by `programs/district`. */
export const STAT_MAX = 20;

/** Maximum number of training credits a citizen can hold. */
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

/** PDA seeds used by `programs/district/src/lib.rs`. */
export const PROGRAM_SEEDS = {
  districtConfig: 'district_config',
  citizenState: 'citizen_state',
} as const;
