use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::MarketError;
use crate::events::AdminAccepted;
use crate::state::MarketConfig;

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin != Pubkey::default() @ MarketError::Unauthorized,
        constraint = config.pending_admin == new_admin.key() @ MarketError::Unauthorized
    )]
    pub config: Account<'info, MarketConfig>,

    pub new_admin: Signer<'info>,
}

impl<'info> AcceptAdmin<'info> {
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let previous_admin = config.admin;

        config.admin = ctx.accounts.new_admin.key();
        config.pending_admin = Pubkey::default();

        emit!(AdminAccepted {
            previous_admin,
            new_admin: config.admin,
        });
        Ok(())
    }
}
