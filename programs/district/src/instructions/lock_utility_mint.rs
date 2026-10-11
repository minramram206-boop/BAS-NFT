use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::DistrictError;
use crate::events::UtilityMintLocked;
use crate::state::DistrictConfig;

#[derive(Accounts)]
pub struct LockUtilityMint<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,

    pub admin: Signer<'info>,
}

impl<'info> LockUtilityMint<'info> {
    /// Irreversible: no instruction clears the lock.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            !config.utility_mint_locked,
            DistrictError::UtilityMintLocked
        );
        require!(config.has_utility_mint(), DistrictError::UtilityMintNotSet);

        config.utility_mint_locked = true;

        emit!(UtilityMintLocked {
            utility_mint: config.utility_mint,
            admin: config.admin,
        });
        Ok(())
    }
}
