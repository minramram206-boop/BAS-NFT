use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::DistrictError;
use crate::events::ConfigUpdated;
use crate::state::DistrictConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct UpdateConfigArgs {
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub base_training_cost: u64,
}

/// Not called `UpdateConfig`: Anchor generates `instruction::UpdateConfig`
/// for the instruction data and the two would collide in the IDL.
#[derive(Accounts)]
pub struct UpdateConfigAccounts<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,

    pub admin: Signer<'info>,
}

impl<'info> UpdateConfigAccounts<'info> {
    /// Only operational parameters move here. Admin, utility mint, pause flag,
    /// collection and template each have their own path or none at all.
    pub fn process(ctx: Context<Self>, args: UpdateConfigArgs) -> Result<()> {
        DistrictConfig::require_valid_parameters(
            &args.mission_authority,
            &args.sol_treasury,
            args.base_training_cost,
        )?;

        let config = &mut ctx.accounts.config;
        config.mission_authority = args.mission_authority;
        config.sol_treasury = args.sol_treasury;
        config.base_training_cost = args.base_training_cost;

        emit!(ConfigUpdated {
            admin: config.admin,
            mission_authority: config.mission_authority,
            sol_treasury: config.sol_treasury,
            base_training_cost: config.base_training_cost,
        });
        Ok(())
    }
}
