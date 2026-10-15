use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::MarketError;
use crate::events::PauseStateChanged;
use crate::state::MarketConfig;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MarketError::Unauthorized
    )]
    pub config: Account<'info, MarketConfig>,

    pub admin: Signer<'info>,
}

impl<'info> SetPaused<'info> {
    /// A pause stops new listings, price changes and sales. Cancelling and
    /// closing stale listings stay open, so nobody's rent is ever locked in.
    pub fn process(ctx: Context<Self>, paused: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if config.is_paused != paused {
            config.is_paused = paused;
            emit!(PauseStateChanged {
                admin: config.admin,
                paused,
            });
        }
        Ok(())
    }
}
