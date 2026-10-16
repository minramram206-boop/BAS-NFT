//! BAS season prize vault (D-0019, D-0101). See docs/PRIZE_VAULT.md.
//!
//! The vault is a PDA owned by this program. Pump.fun's fee sharing sends the
//! prize share of the creator fees to it, and there is no instruction that
//! sends SOL anywhere but to a published winner: the authority sets part of
//! the pool aside for a season (`fund_season`), publishes the winners as a
//! Merkle root after the season (`finalize_winners`), and each winner signs
//! their own `claim` once the dispute window has passed. Whatever is not
//! claimed in time goes back to the pool (`rollover`).
//!
//! Each instruction lives in `instructions/<name>.rs` next to its accounts.
//! This file only wires them into the Anchor program.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod merkle;
pub mod pda;
pub mod state;

pub use instructions::*;

declare_id!("5A2vzRDhfPfzpZrtvmhx6HFLLD2xmdcHStDwzPcNuXUP");

#[program]
pub mod prize_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Initialize::process(ctx)
    }

    pub fn fund_season(
        ctx: Context<FundSeason>,
        season_id: u32,
        amount_lamports: u64,
        ends_at: i64,
    ) -> Result<()> {
        FundSeason::process(ctx, season_id, amount_lamports, ends_at)
    }

    pub fn finalize_winners(
        ctx: Context<FinalizeWinners>,
        season_id: u32,
        args: FinalizeWinnersArgs,
    ) -> Result<()> {
        FinalizeWinners::process(ctx, season_id, args)
    }

    pub fn claim(ctx: Context<Claim>, season_id: u32, args: ClaimArgs) -> Result<()> {
        Claim::process(ctx, season_id, args)
    }

    pub fn rollover(ctx: Context<Rollover>, season_id: u32) -> Result<()> {
        Rollover::process(ctx, season_id)
    }

    pub fn propose_authority(ctx: Context<ProposeAuthority>, proposed: Pubkey) -> Result<()> {
        ProposeAuthority::process(ctx, proposed)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        AcceptAuthority::process(ctx)
    }
}
