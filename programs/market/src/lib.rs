//! BAS market: fixed-price sales (phase F1, D-0082) and English auctions
//! (phase F3, D-0087) of district citizens for SOL. See docs/MARKET.md.
//!
//! A listed citizen never leaves the seller's wallet: the seller names this
//! program's authority PDA as the asset's Core transfer delegate, and `buy`
//! moves the asset as that delegate in the same instruction that pays the
//! seller and the royalty. An auctioned citizen is handed to the authority
//! PDA when the auction starts (D-0092), so the seller cannot take it back
//! once someone has bid; `settle_auction` hands it to the winner, or back to
//! the seller without a bid. The program holds SOL only for an auction's
//! highest bid.
//!
//! Each instruction lives in `instructions/<name>.rs` next to its accounts.
//! This file only wires them into the Anchor program.

use anchor_lang::prelude::*;

pub mod constants;
pub mod core_asset;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod pda;
pub mod sale;
pub mod state;

pub use instructions::*;

declare_id!("EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP");

#[program]
pub mod market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        InitializeConfig::process(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfigAccounts>, args: UpdateConfigArgs) -> Result<()> {
        UpdateConfigAccounts::process(ctx, args)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        SetPaused::process(ctx, paused)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, proposed_admin: Pubkey) -> Result<()> {
        ProposeAdmin::process(ctx, proposed_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        AcceptAdmin::process(ctx)
    }

    pub fn create_listing(ctx: Context<CreateListing>, price_lamports: u64) -> Result<()> {
        CreateListing::process(ctx, price_lamports)
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price_lamports: u64) -> Result<()> {
        UpdatePrice::process(ctx, price_lamports)
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        CancelListing::process(ctx)
    }

    pub fn close_stale_listing(ctx: Context<CloseStaleListing>) -> Result<()> {
        CloseStaleListing::process(ctx)
    }

    pub fn buy(ctx: Context<Buy>, max_price_lamports: u64) -> Result<()> {
        Buy::process(ctx, max_price_lamports)
    }

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        start_price_lamports: u64,
        duration_hours: u8,
    ) -> Result<()> {
        CreateAuction::process(ctx, start_price_lamports, duration_hours)
    }

    pub fn place_bid(ctx: Context<PlaceBid>, amount_lamports: u64) -> Result<()> {
        PlaceBid::process(ctx, amount_lamports)
    }

    pub fn cancel_auction(ctx: Context<CancelAuction>) -> Result<()> {
        CancelAuction::process(ctx)
    }

    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        SettleAuction::process(ctx)
    }
}
