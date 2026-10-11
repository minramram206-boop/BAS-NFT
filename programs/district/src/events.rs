//! Program events (SPEC §13, plus `ConfigUpdated`).
//!
//! `solana-program-test` cannot observe `emit!`, so the payloads are only
//! checked by `anchor test` against a validator (D-0012).

use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub collection_mint: Pubkey,
    pub approved_template_id: u32,
    pub base_training_cost: u64,
    pub is_paused: bool,
}

/// Emitted whenever `update_config` changes the operational parameters.
#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub base_training_cost: u64,
}

#[event]
pub struct UtilityMintSet {
    pub utility_mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub admin: Pubkey,
}

#[event]
pub struct UtilityMintLocked {
    pub utility_mint: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct CitizenRegistered {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub citizen_id: u32,
    pub role: u8,
    pub role_label: String,
    pub intelligence: u8,
    pub alignment: u8,
    pub compute: u8,
    pub total_registered_citizens: u32,
}

#[event]
pub struct TrainingCreditClaimed {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub stat: u8,
    pub mission_id: u64,
    pub season_id: u32,
    pub nonce: u64,
    pub remaining_credits: u16,
}

#[event]
pub struct ScoreUpgraded {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub stat: u8,
    pub previous_score: u8,
    pub new_score: u8,
    pub new_tier: u8,
    pub tokens_burned: u64,
    pub remaining_credits: u16,
}

#[event]
pub struct AdminProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
}

#[event]
pub struct AdminAccepted {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

/// Emitted only on a real transition, not on a repeated value.
#[event]
pub struct PauseStateChanged {
    pub admin: Pubkey,
    pub paused: bool,
}
