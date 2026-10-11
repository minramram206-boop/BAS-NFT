use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::DistrictError;
use crate::events::UtilityMintSet;
use crate::state::DistrictConfig;
use crate::utility_token::verify_utility_mint;

#[derive(Accounts)]
pub struct SetUtilityMint<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,

    /// CHECK: owner, layout and decimals are verified by `verify_utility_mint`
    /// so each failure maps to a SPEC §13 error.
    pub utility_mint: UncheckedAccount<'info>,

    pub admin: Signer<'info>,
}

impl<'info> SetUtilityMint<'info> {
    /// Binds the official token while unlocked. `expected_decimals` must match
    /// the decimals `base_training_cost` was priced in (6 for Pump.fun coins).
    pub fn process(ctx: Context<Self>, expected_decimals: u8) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            !config.utility_mint_locked,
            DistrictError::UtilityMintLocked
        );

        let mint = verify_utility_mint(&ctx.accounts.utility_mint, expected_decimals)?;
        config.utility_mint = ctx.accounts.utility_mint.key();

        emit!(UtilityMintSet {
            utility_mint: config.utility_mint,
            token_program: mint.token_program,
            decimals: mint.decimals,
            admin: config.admin,
        });
        Ok(())
    }
}
