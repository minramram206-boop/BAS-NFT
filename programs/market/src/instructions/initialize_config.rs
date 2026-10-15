use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::constants::{CONFIG_SEED, MARKET_CONFIG_VERSION};
use crate::core_asset::MPL_CORE_PROGRAM_ID;
use crate::errors::MarketError;
use crate::events::ConfigInitialized;
use crate::pda;
use crate::state::MarketConfig;

/// `Key::CollectionV1` in Core.
const KEY_COLLECTION_V1: u8 = 5;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitializeConfigArgs {
    pub royalty_bps: u16,
    pub fee_bps: u16,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = MarketConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, MarketConfig>,

    /// CHECK: must be a Core collection; checked in the handler.
    #[account(owner = MPL_CORE_PROGRAM_ID @ MarketError::InvalidConfig)]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: any funded account; checked in `require_valid_payouts`.
    pub royalty_recipient: UncheckedAccount<'info>,

    /// CHECK: any funded account; checked in `require_valid_payouts`.
    pub fee_recipient: UncheckedAccount<'info>,

    /// This program's ProgramData. Only its upgrade authority may initialize,
    /// so nobody can claim the admin seat between deploy and setup.
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ MarketError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

    /// Upgrade authority; becomes the first admin and pays rent.
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeConfig<'info> {
    /// The market starts paused, so the admin can check the royalty against
    /// the collection before the first listing.
    pub fn process(ctx: Context<Self>, args: InitializeConfigArgs) -> Result<()> {
        let is_collection =
            ctx.accounts.collection.try_borrow_data()?.first().copied() == Some(KEY_COLLECTION_V1);
        require!(is_collection, MarketError::InvalidConfig);
        MarketConfig::require_valid_payouts(
            args.royalty_bps,
            &ctx.accounts.royalty_recipient,
            args.fee_bps,
            &ctx.accounts.fee_recipient,
        )?;

        let config = &mut ctx.accounts.config;
        config.set_inner(MarketConfig {
            version: MARKET_CONFIG_VERSION,
            admin: ctx.accounts.admin.key(),
            pending_admin: Pubkey::default(),
            collection: ctx.accounts.collection.key(),
            royalty_bps: args.royalty_bps,
            royalty_recipient: ctx.accounts.royalty_recipient.key(),
            fee_bps: args.fee_bps,
            fee_recipient: ctx.accounts.fee_recipient.key(),
            is_paused: true,
            bump: ctx.bumps.config,
            authority_bump: pda::authority_address().1,
        });

        emit!(ConfigInitialized {
            admin: config.admin,
            collection: config.collection,
            royalty_bps: config.royalty_bps,
            royalty_recipient: config.royalty_recipient,
            fee_bps: config.fee_bps,
            fee_recipient: config.fee_recipient,
            is_paused: config.is_paused,
        });
        Ok(())
    }
}
