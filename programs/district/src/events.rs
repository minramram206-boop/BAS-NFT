//! Program events.
//!
//! The set is the one listed in `PIXEL_DISTRICT_SPEC_V2_ID.md` §13. Names and
//! field names are English because §1.3 requires it for events.
//!
//! Note for anyone testing these: `solana-program-test` cannot observe `emit!`.
//! The runtime collects logs with `LogCollectorFilter::ExcludeReturnData` and
//! the program runs as a native builtin rather than through the BPF VM, so the
//! `sol_log_data` call behind `emit!` is dropped before it reaches the returned
//! logs. `programs/district/tests/integration.rs` therefore asserts committed
//! account state, and the payloads below still need an `anchor test` run
//! against a real validator. Recorded as D-0012.

use anchor_lang::prelude::*;

/// Emitted once, by `initialize_config`.
#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub collection_mint: Pubkey,
    pub approved_template_id: u32,
    pub base_training_cost: u64,
    /// Mainnet is initialized paused (§12, `AGENT_START_HERE.md` §4).
    pub is_paused: bool,
}

/// Emitted by `set_utility_mint`, which is only callable before the lock.
#[event]
pub struct UtilityMintSet {
    pub utility_mint: Pubkey,
    pub admin: Pubkey,
}

/// Emitted once by `lock_utility_mint`. Irreversible (§5.2: the official token
/// mint is bound permanently and no second upgrade token may ever exist).
#[event]
pub struct UtilityMintLocked {
    pub utility_mint: Pubkey,
    pub admin: Pubkey,
}

/// Emitted when an asset becomes a citizen (§6.3 item 7).
#[event]
pub struct CitizenRegistered {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub citizen_id: u32,
    pub role: u8,
    /// Public label of the role, so an indexer does not need the registry.
    pub role_label: String,
    pub intelligence: u8,
    pub alignment: u8,
    pub compute: u8,
    pub total_registered_citizens: u32,
}

/// Emitted by `claim_training_credit` (§12).
#[event]
pub struct TrainingCreditClaimed {
    pub asset: Pubkey,
    pub owner: Pubkey,
    /// 0 = Insight, 1 = Bond, 2 = Craft.
    pub stat: u8,
    pub mission_id: u64,
    pub season_id: u32,
    pub nonce: u64,
    /// Balance of that one credit kind after the claim.
    pub remaining_credits: u16,
}

/// Emitted by `upgrade_score` after the burn, the credit consumption and the
/// score change have all been applied (§12: atomically).
#[event]
pub struct ScoreUpgraded {
    pub asset: Pubkey,
    pub owner: Pubkey,
    /// 0 = Insight, 1 = Bond, 2 = Craft.
    pub stat: u8,
    pub previous_score: u8,
    pub new_score: u8,
    /// Tier of the new score, 1..=3 (§7).
    pub new_tier: u8,
    /// Full training cost, in token atoms (§5.3). 100% of it is burned.
    pub tokens_burned: u64,
    /// Balance of the matching credit kind after consumption.
    pub remaining_credits: u16,
}

/// Emitted by `propose_admin`.
#[event]
pub struct AdminProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
}

/// Emitted by `accept_admin`, which completes the two-step transfer.
#[event]
pub struct AdminAccepted {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

/// Emitted by `set_paused` on every real transition.
#[event]
pub struct PauseStateChanged {
    pub admin: Pubkey,
    pub paused: bool,
}
