//! Seeds, limits and layout versions shared by every instruction.
//!
//! `packages/chain-client` mirrors these values and its tests read this file,
//! so change both sides together.

/// PDA seed of the single `DistrictConfig` account.
pub const CONFIG_SEED: &[u8] = b"district_config";

/// PDA seed prefix of an `ApprovedTemplate`, followed by the template id (LE).
pub const APPROVED_TEMPLATE_SEED: &[u8] = b"approved_template";

/// PDA seed prefix of a `CitizenState`, followed by the Core asset address.
pub const CITIZEN_SEED: &[u8] = b"citizen";

/// PDA seed prefix of a `ClaimReceipt`, followed by asset, mission id and nonce.
pub const CLAIM_SEED: &[u8] = b"claim";

pub const DISTRICT_CONFIG_VERSION: u8 = 1;
pub const APPROVED_TEMPLATE_VERSION: u8 = 1;
pub const CITIZEN_STATE_VERSION: u8 = 1;
pub const CLAIM_RECEIPT_VERSION: u8 = 1;

/// Highest score a single stat can reach.
pub const STAT_MAX: u8 = 10;

pub const TIER_1_SCORE: u8 = 3;
pub const TIER_2_SCORE: u8 = 6;
pub const TIER_3_SCORE: u8 = STAT_MAX;

/// Credits consumed by one upgrade and granted by one mission claim.
pub const CREDITS_PER_UPGRADE: u16 = 1;

/// Longest metadata URI prefix an approved template may store.
pub const MAX_APPROVED_TEMPLATE_URI_PREFIX_LEN: usize = 200;
