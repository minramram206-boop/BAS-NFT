use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, SEASON_SEED, SEASON_VERSION, VAULT_SEED};
use crate::errors::PrizeError;
use crate::events::SeasonFunded;
use crate::state::{PrizeConfig, PrizeVault, Season};

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct FundSeason<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ PrizeError::Unauthorized
    )]
    pub config: Account<'info, PrizeConfig>,

    #[account(seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, PrizeVault>,

    #[account(
        init_if_needed,
        payer = authority,
        space = Season::LEN,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump
    )]
    pub season: Account<'info, Season>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> FundSeason<'info> {
    /// Sets `amount_lamports` of the vault's unallocated SOL aside for a
    /// season. The first call opens the season with its end; later calls add
    /// to it while it runs. Nothing lowers a season's funding.
    pub fn process(
        ctx: Context<Self>,
        season_id: u32,
        amount_lamports: u64,
        ends_at: i64,
    ) -> Result<()> {
        require!(amount_lamports > 0, PrizeError::InvalidAmount);
        let now = Clock::get()?.unix_timestamp;
        let season = &mut ctx.accounts.season;

        if season.version == 0 {
            require!(ends_at > now, PrizeError::InvalidSeasonEnd);
            season.version = SEASON_VERSION;
            season.season_id = season_id;
            season.ends_at = ends_at;
            season.bump = ctx.bumps.season;
        } else {
            require!(ends_at == season.ends_at, PrizeError::SeasonEndChanged);
            require!(now < season.ends_at, PrizeError::SeasonEnded);
        }

        let config = &mut ctx.accounts.config;
        let vault = ctx.accounts.vault.to_account_info();
        let rent = Rent::get()?.minimum_balance(vault.data_len());
        let unallocated = vault
            .lamports()
            .saturating_sub(rent)
            .saturating_sub(config.reserved_lamports);
        require!(
            amount_lamports <= unallocated,
            PrizeError::NotEnoughUnallocated
        );

        config.reserved_lamports = config
            .reserved_lamports
            .checked_add(amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;
        season.funded_lamports = season
            .funded_lamports
            .checked_add(amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;

        emit!(SeasonFunded {
            season_id,
            amount_lamports,
            funded_lamports: season.funded_lamports,
            ends_at: season.ends_at,
        });
        Ok(())
    }
}
