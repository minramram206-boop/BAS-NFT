use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Token, TokenAccount};

pub mod errors;
pub mod state;

use errors::*;
use state::*;

declare_id!("BASDistr1ct1111111111111111111111111111111");

#[program]
pub mod district {
    use super::*;

    pub fn initialize_district(
        ctx: Context<InitializeDistrict>,
        burn_amount: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.utility_mint = ctx.accounts.utility_mint.key();
        config.collection_mint = ctx.accounts.collection_mint.key();
        config.burn_amount_required = burn_amount;
        config.total_registered_citizens = 0;
        config.is_paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn register_citizen(
        ctx: Context<RegisterCitizen>,
        initial_int: u8,
        initial_aln: u8,
        initial_cmp: u8,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.is_paused, DistrictError::ProgramPaused);

        let citizen = &mut ctx.accounts.citizen_state;
        citizen.asset = ctx.accounts.asset.key();
        citizen.owner = ctx.accounts.owner.key();
        citizen.intelligence = initial_int.min(20);
        citizen.alignment = initial_aln.min(20);
        citizen.composure = initial_cmp.min(20);
        citizen.training_credits = 1;
        citizen.total_burns = 0;
        citizen.bump = ctx.bumps.citizen_state;

        config.total_registered_citizens = config.total_registered_citizens.saturating_add(1);
        Ok(())
    }

    pub fn train_stat(
        ctx: Context<TrainStat>,
        stat: CitizenStat,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.is_paused, DistrictError::ProgramPaused);

        let citizen = &mut ctx.accounts.citizen_state;
        require!(
            citizen.owner == ctx.accounts.owner.key(),
            DistrictError::UnauthorizedCitizenOwner
        );
        require!(
            citizen.training_credits > 0,
            DistrictError::InsufficientTrainingCredits
        );

        // Check max stat
        match stat {
            CitizenStat::Intelligence => {
                require!(citizen.intelligence < 20, DistrictError::StatAlreadyMaxed);
                citizen.intelligence = citizen.intelligence.saturating_add(1);
            }
            CitizenStat::Alignment => {
                require!(citizen.alignment < 20, DistrictError::StatAlreadyMaxed);
                citizen.alignment = citizen.alignment.saturating_add(1);
            }
            CitizenStat::Composure => {
                require!(citizen.composure < 20, DistrictError::StatAlreadyMaxed);
                citizen.composure = citizen.composure.saturating_add(1);
            }
        }

        // Consume 1 Training Credit
        citizen.training_credits = citizen.training_credits.saturating_sub(1);
        citizen.total_burns = citizen.total_burns.saturating_add(1);

        // 100% token burn via CPI
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.utility_mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::burn(burn_ctx, config.burn_amount_required)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeDistrict<'info> {
    #[account(
        init,
        payer = authority,
        space = DistrictConfig::LEN,
        seeds = [b"district_config"],
        bump
    )]
    pub config: Account<'info, DistrictConfig>,
    pub utility_mint: AccountInfo<'info>,
    pub collection_mint: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterCitizen<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump
    )]
    pub config: Account<'info, DistrictConfig>,
    pub asset: AccountInfo<'info>,
    #[account(
        init,
        payer = owner,
        space = CitizenState::LEN,
        seeds = [b"citizen_state", asset.key().as_ref()],
        bump
    )]
    pub citizen_state: Account<'info, CitizenState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TrainStat<'info> {
    #[account(
        seeds = [b"district_config"],
        bump = config.bump
    )]
    pub config: Account<'info, DistrictConfig>,
    #[account(
        mut,
        seeds = [b"citizen_state", citizen_state.asset.as_ref()],
        bump = citizen_state.bump
    )]
    pub citizen_state: Account<'info, CitizenState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub utility_mint: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
