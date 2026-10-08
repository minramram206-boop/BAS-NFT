use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Token, TokenAccount};

pub mod errors;
pub mod events;
pub mod state;

use errors::*;
use events::*;
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

    /// Pause or resume registration and training.
    ///
    /// The release sequence requires mainnet to be deployed paused and only
    /// unpaused after the token binding, treasury, multisig, vault, and program
    /// configuration have been verified, so this is the only instruction that
    /// may flip `DistrictConfig::is_paused`.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        // The `has_one = authority` constraint on `SetPaused` already proved
        // that the signer is the district authority.
        let config = &mut ctx.accounts.config;

        // Emit the transition so monitors and the audit log can follow it.
        if config.is_paused != paused {
            emit!(DistrictPausedChanged {
                authority: ctx.accounts.authority.key(),
                paused,
            });
        }

        config.is_paused = paused;
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
        citizen.intelligence = initial_int.min(STAT_MAX);
        citizen.alignment = initial_aln.min(STAT_MAX);
        citizen.composure = initial_cmp.min(STAT_MAX);
        citizen.training_credits = INITIAL_TRAINING_CREDITS;
        citizen.total_burns = 0;
        citizen.bump = ctx.bumps.citizen_state;

        config.total_registered_citizens = config.total_registered_citizens.saturating_add(1);

        emit!(CitizenRegistered {
            asset: citizen.asset,
            owner: citizen.owner,
            total_registered_citizens: config.total_registered_citizens,
        });
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

        // The burned asset must be the one official utility token bound at
        // initialization. Without this check a caller could pass any mint they
        // control, burn a worthless token, and still raise a canonical score.
        require!(
            ctx.accounts.utility_mint.key() == config.utility_mint,
            DistrictError::InvalidUtilityMint
        );
        require!(
            ctx.accounts.user_token_account.owner == ctx.accounts.owner.key(),
            DistrictError::UnauthorizedCitizenOwner
        );
        require!(
            ctx.accounts.user_token_account.mint == config.utility_mint,
            DistrictError::InvalidUtilityMint
        );

        // Check max stat
        match stat {
            CitizenStat::Intelligence => {
                require!(citizen.intelligence < STAT_MAX, DistrictError::StatAlreadyMaxed);
                citizen.intelligence = citizen.intelligence.saturating_add(1);
            }
            CitizenStat::Alignment => {
                require!(citizen.alignment < STAT_MAX, DistrictError::StatAlreadyMaxed);
                citizen.alignment = citizen.alignment.saturating_add(1);
            }
            CitizenStat::Composure => {
                require!(citizen.composure < STAT_MAX, DistrictError::StatAlreadyMaxed);
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

        emit!(StatTrained {
            asset: citizen.asset,
            owner: citizen.owner,
            stat: stat as u8,
            new_score: match stat {
                CitizenStat::Intelligence => citizen.intelligence,
                CitizenStat::Alignment => citizen.alignment,
                CitizenStat::Composure => citizen.composure,
            },
            tokens_burned: config.burn_amount_required,
            remaining_training_credits: citizen.training_credits,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        has_one = authority @ DistrictError::UnauthorizedAuthority
    )]
    pub config: Account<'info, DistrictConfig>,
    pub authority: Signer<'info>,
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
    /// Metaplex asset (or its metadata account) that becomes a citizen.
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
