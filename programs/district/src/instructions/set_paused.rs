use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::DistrictError;
use crate::events::PauseStateChanged;
use crate::state::DistrictConfig;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,

    pub admin: Signer<'info>,
}

impl<'info> SetPaused<'info> {
    /// Pausing is always allowed. Resuming requires a locked utility mint, so
    /// the release order of SPEC §5.7 is enforced on chain.
    pub fn process(ctx: Context<Self>, paused: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if !paused {
            require!(
                config.utility_mint_locked,
                DistrictError::UtilityMintNotLocked
            );
        }

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
