use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::MarketError;
use crate::events::ConfigUpdated;
use crate::state::MarketConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct UpdateConfigArgs {
    pub royalty_bps: u16,
    pub fee_bps: u16,
}

/// Not called `UpdateConfig`: Anchor generates `instruction::UpdateConfig`
/// for the instruction data and the two would collide in the IDL.
#[derive(Accounts)]
pub struct UpdateConfigAccounts<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MarketError::Unauthorized
    )]
    pub config: Account<'info, MarketConfig>,

    /// CHECK: any funded account; checked in `require_valid_payouts`.
    pub royalty_recipient: UncheckedAccount<'info>,

    /// CHECK: any funded account; checked in `require_valid_payouts`.
    pub fee_recipient: UncheckedAccount<'info>,

    pub admin: Signer<'info>,
}

impl<'info> UpdateConfigAccounts<'info> {
    /// Payout terms only. Collection and admin have no path here, and the
    /// pause flag has its own instruction. Open listings sell on the new terms.
    pub fn process(ctx: Context<Self>, args: UpdateConfigArgs) -> Result<()> {
        MarketConfig::require_valid_payouts(
            args.royalty_bps,
            &ctx.accounts.royalty_recipient,
            args.fee_bps,
            &ctx.accounts.fee_recipient,
        )?;

        let config = &mut ctx.accounts.config;
        config.royalty_bps = args.royalty_bps;
        config.royalty_recipient = ctx.accounts.royalty_recipient.key();
        config.fee_bps = args.fee_bps;
        config.fee_recipient = ctx.accounts.fee_recipient.key();

        emit!(ConfigUpdated {
            admin: config.admin,
            royalty_bps: config.royalty_bps,
            royalty_recipient: config.royalty_recipient,
            fee_bps: config.fee_bps,
            fee_recipient: config.fee_recipient,
        });
        Ok(())
    }
}
