//! BAS District 01: citizen registration, mission credits and token-burn
//! training on Solana. Instruction set follows BAS_DISTRICT_SPEC_V2 §12.
//!
//! Each instruction lives in `instructions/<name>.rs` next to its accounts.
//! This file only wires them into the Anchor program.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod mpl_core;
pub mod pda;
pub mod progression;
pub mod roles;
pub mod state;
pub mod utility_token;

pub use instructions::*;

declare_id!("82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym");

#[program]
pub mod district {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        InitializeConfig::process(ctx, args)
    }

    pub fn set_utility_mint(ctx: Context<SetUtilityMint>, expected_decimals: u8) -> Result<()> {
        SetUtilityMint::process(ctx, expected_decimals)
    }

    pub fn lock_utility_mint(ctx: Context<LockUtilityMint>) -> Result<()> {
        LockUtilityMint::process(ctx)
    }

    pub fn update_config(ctx: Context<UpdateConfigAccounts>, args: UpdateConfigArgs) -> Result<()> {
        UpdateConfigAccounts::process(ctx, args)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        SetPaused::process(ctx, paused)
    }

    pub fn register_citizen(ctx: Context<RegisterCitizen>) -> Result<()> {
        RegisterCitizen::process(ctx)
    }

    pub fn claim_training_credit(
        ctx: Context<ClaimTrainingCredit>,
        args: MissionClaimArgs,
    ) -> Result<()> {
        ClaimTrainingCredit::process(ctx, args)
    }

    pub fn upgrade_score(ctx: Context<UpgradeScore>, stat_index: u8) -> Result<()> {
        UpgradeScore::process(ctx, stat_index)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, proposed_admin: Pubkey) -> Result<()> {
        ProposeAdmin::process(ctx, proposed_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        AcceptAdmin::process(ctx)
    }
}
