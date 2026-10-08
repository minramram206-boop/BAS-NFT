/** Protocol constants shared by the on-chain program and its clients. */

/** Maximum score of a single citizen stat, mirrored by `programs/district`. */
export const STAT_MAX = 20;

/** Maximum number of training credits a citizen can hold. */
export const TRAINING_CREDITS_MAX = 65_535;

/** PDA seeds used by `programs/district/src/lib.rs`. */
export const PROGRAM_SEEDS = {
  districtConfig: 'district_config',
  citizenState: 'citizen_state',
} as const;
