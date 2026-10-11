use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::constants::{CITIZEN_SEED, CONFIG_SEED, CREDITS_PER_UPGRADE, STAT_MAX};
use crate::errors::DistrictError;
use crate::events::ScoreUpgraded;
use crate::mpl_core::{load_collection_member, MPL_CORE_PROGRAM_ID};
use crate::progression::{tier_for_score, training_cost_atoms};
use crate::state::{CitizenStat, CitizenState, DistrictConfig};

#[derive(Accounts)]
pub struct UpgradeScore<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.is_paused @ DistrictError::ProgramPaused,
        constraint = config.has_utility_mint() @ DistrictError::UtilityMintNotSet,
        constraint = config.utility_mint_locked @ DistrictError::UtilityMintNotLocked
    )]
    pub config: Account<'info, DistrictConfig>,

    /// CHECK: must be owned by Metaplex Core; parsed by `load_collection_member`.
    #[account(owner = MPL_CORE_PROGRAM_ID @ DistrictError::InvalidAssetState)]
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CITIZEN_SEED, asset.key().as_ref()],
        bump = citizen_state.bump
    )]
    pub citizen_state: Account<'info, CitizenState>,

    /// Current holder of the asset; authorizes the burn.
    pub owner: Signer<'info>,

    #[account(
        mut,
        address = config.utility_mint @ DistrictError::InvalidUtilityMint,
        mint::token_program = token_program
    )]
    pub utility_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_account.mint == utility_mint.key()
            @ DistrictError::InvalidUtilityMint,
        constraint = user_token_account.owner == owner.key() @ DistrictError::NotOwner,
        token::token_program = token_program
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// SPL Token or Token-2022, whichever owns the bound mint.
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> UpgradeScore<'info> {
    /// Burns the full training cost, consumes one matching credit and raises
    /// the stat by one, all in one instruction (SPEC §5.3, §12).
    pub fn process(ctx: Context<Self>, stat_index: u8) -> Result<()> {
        let stat = CitizenStat::from_index(stat_index)?;
        let accounts = &ctx.accounts;
        let holder = load_collection_member(
            &accounts.asset.to_account_info(),
            &accounts.config.collection_mint,
            &accounts.owner.key(),
        )?;

        let previous_score = accounts.citizen_state.score_of(stat);
        require!(previous_score < STAT_MAX, DistrictError::MaxScore);
        require!(
            accounts.citizen_state.credits_of(stat) >= CREDITS_PER_UPGRADE,
            DistrictError::InsufficientTrainingCredits
        );

        let cost = training_cost_atoms(accounts.config.base_training_cost, previous_score)?;
        require!(
            accounts.user_token_account.amount >= cost,
            DistrictError::InsufficientTokenBalance
        );

        token_interface::burn(
            CpiContext::new(
                accounts.token_program.to_account_info(),
                Burn {
                    mint: accounts.utility_mint.to_account_info(),
                    from: accounts.user_token_account.to_account_info(),
                    authority: accounts.owner.to_account_info(),
                },
            ),
            cost,
        )?;

        let citizen = &mut ctx.accounts.citizen_state;
        citizen.consume_credit(stat)?;
        let new_score = citizen.raise(stat);

        emit!(ScoreUpgraded {
            asset: citizen.asset,
            owner: holder.owner,
            stat: stat as u8,
            previous_score,
            new_score,
            new_tier: tier_for_score(new_score),
            tokens_burned: cost,
            remaining_credits: citizen.credits_of(stat),
        });
        Ok(())
    }
}
