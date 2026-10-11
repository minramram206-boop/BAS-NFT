use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::DistrictError;
use crate::events::AdminProposed;
use crate::state::DistrictConfig;

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,

    pub admin: Signer<'info>,
}

impl<'info> ProposeAdmin<'info> {
    /// Step one of a two-step transfer. A new proposal replaces the old one.
    pub fn process(ctx: Context<Self>, proposed_admin: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            proposed_admin != config.admin && proposed_admin != Pubkey::default(),
            DistrictError::Unauthorized
        );

        config.pending_admin = proposed_admin;

        emit!(AdminProposed {
            current_admin: config.admin,
            proposed_admin,
        });
        Ok(())
    }
}
