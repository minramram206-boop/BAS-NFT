use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, DISPUTE_HOURS, HOUR_SECONDS, MAX_WINNERS, SEASON_SEED};
use crate::errors::PrizeError;
use crate::events::WinnersFinalized;
use crate::state::{PrizeConfig, Season};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct FinalizeWinnersArgs {
    pub winners_root: [u8; 32],
    pub winners: u8,
    pub prizes_lamports: u64,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct FinalizeWinners<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ PrizeError::Unauthorized
    )]
    pub config: Account<'info, PrizeConfig>,

    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,

    pub authority: Signer<'info>,
}

impl<'info> FinalizeWinners<'info> {
    /// Publishes the winners after the season ends. Claims open once the
    /// dispute window has passed; until then the authority may publish a
    /// corrected list, which starts the window again. A season where no pool
    /// had enough entries is published with no winners and no prizes, so its
    /// funding can roll over.
    pub fn process(ctx: Context<Self>, _season_id: u32, args: FinalizeWinnersArgs) -> Result<()> {
        // Only the fast build writes this line; scripts/devnet/deploy.sh looks for it.
        #[cfg(feature = "devnet-clock")]
        msg!("BAS devnet prize clock");
        let now = Clock::get()?.unix_timestamp;
        let season = &mut ctx.accounts.season;
        require!(now >= season.ends_at, PrizeError::SeasonNotEnded);
        require!(!season.leftover_released, PrizeError::AlreadyRolledOver);
        if season.is_finalized() {
            require!(now < season.claims_open_at, PrizeError::ClaimsAlreadyOpen);
        }
        require!(
            args.winners <= MAX_WINNERS && (args.winners == 0) == (args.prizes_lamports == 0),
            PrizeError::InvalidWinnerCount
        );
        require!(
            args.prizes_lamports <= season.funded_lamports,
            PrizeError::PrizesOverFunding
        );

        let claims_open_at = now
            .checked_add(DISPUTE_HOURS * HOUR_SECONDS)
            .ok_or(PrizeError::MathOverflow)?;
        season.winners_root = args.winners_root;
        season.winners = args.winners;
        season.prizes_lamports = args.prizes_lamports;
        season.finalized_at = now;
        season.claims_open_at = claims_open_at;

        emit!(WinnersFinalized {
            season_id: season.season_id,
            winners_root: season.winners_root,
            winners: season.winners,
            prizes_lamports: season.prizes_lamports,
            claims_open_at,
        });
        Ok(())
    }
}
