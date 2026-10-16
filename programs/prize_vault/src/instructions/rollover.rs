use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, SEASON_SEED};
use crate::errors::PrizeError;
use crate::events::SeasonRolledOver;
use crate::state::{PrizeConfig, Season};

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct Rollover<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PrizeConfig>,

    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,

    /// Anyone may roll a season over once it is due.
    pub caller: Signer<'info>,
}

impl<'info> Rollover<'info> {
    /// Gives back to the pool the part of a season's funding that no
    /// published winner holds, where the next `fund_season` can use it. Due
    /// once the winners are published and the dispute window has passed.
    /// The prizes stay reserved for their winners, with no deadline, and the
    /// SOL never leaves the vault.
    pub fn process(ctx: Context<Self>, _season_id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let season = &mut ctx.accounts.season;
        require!(!season.leftover_released, PrizeError::AlreadyRolledOver);
        require!(
            season.is_finalized() && now >= season.claims_open_at,
            PrizeError::RolloverNotReady
        );

        let released = season.leftover_lamports();
        season.leftover_released = true;
        let config = &mut ctx.accounts.config;
        config.reserved_lamports = config
            .reserved_lamports
            .checked_sub(released)
            .ok_or(PrizeError::MathOverflow)?;

        emit!(SeasonRolledOver {
            season_id: season.season_id,
            released_lamports: released,
        });
        Ok(())
    }
}
