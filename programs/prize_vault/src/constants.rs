//! Seeds, limits and windows shared by every instruction.
//!
//! `packages/chain-client/src/prize-vault.ts` repeats the seeds, the winner
//! limits and the leaf layout; its tests read this file to check they agree.

/// PDA seed of the single `PrizeConfig` account.
pub const CONFIG_SEED: &[u8] = b"prize-config";

/// PDA seed of the vault that holds the whole prize pool. Pump.fun's fee
/// sharing pays the creator-fee share straight to this address (D-0019).
pub const VAULT_SEED: &[u8] = b"prize-vault";

/// PDA seed prefix of a `Season`, followed by its id as 4 little-endian bytes.
pub const SEASON_SEED: &[u8] = b"season";

pub const CONFIG_VERSION: u8 = 1;
pub const VAULT_VERSION: u8 = 1;
pub const SEASON_VERSION: u8 = 1;

/// Cash winners of one season across all five pools (PRIZE_POOL_MODEL §7.1:
/// 10 + 10 + 7 + 5 + 3).
pub const MAX_WINNERS: u8 = 35;

/// No single prize may exceed this share of the season's funding: the largest
/// pool (open, 30%) paid to one winner.
pub const MAX_PRIZE_BPS: u64 = 3_000;

pub const BPS_DENOMINATOR: u64 = 10_000;

/// A proof for 35 leaves is 6 hashes long; anything over this is refused.
pub const MAX_PROOF_LEN: usize = 8;

/// Domain prefixes of the Merkle tree, so a leaf can never pass for a node.
pub const LEAF_PREFIX: &[u8] = &[0];
pub const NODE_PREFIX: &[u8] = &[1];

// The prize clock. A build with `--features devnet-clock` runs it 360 times
// faster, the same factor as the market's auction clock, so a season can be
// finalized and claimed on devnet within minutes: the dispute window lasts
// 8 minutes. `scripts/devnet/deploy.sh` refuses such a binary anywhere but
// devnet.

/// Seconds that one hour of the prize windows lasts.
#[cfg(not(feature = "devnet-clock"))]
pub const HOUR_SECONDS: i64 = 3_600;
#[cfg(feature = "devnet-clock")]
pub const HOUR_SECONDS: i64 = 10;

/// After the winners are published, anyone may check them for this long
/// before the first claim; the authority may still correct the list.
pub const DISPUTE_HOURS: i64 = 48;

// A prize has no claim deadline (D-0102): it waits in the vault for its
// winner however long that takes. Only funding no winner holds rolls over.
