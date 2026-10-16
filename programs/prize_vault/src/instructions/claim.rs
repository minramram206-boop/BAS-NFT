use anchor_lang::prelude::*;

use crate::constants::{
    BPS_DENOMINATOR, CONFIG_SEED, MAX_PRIZE_BPS, MAX_PROOF_LEN, SEASON_SEED, VAULT_SEED,
};
use crate::errors::PrizeError;
use crate::events::PrizeClaimed;
use crate::merkle;
use crate::state::{PrizeConfig, PrizeVault, Season};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimArgs {
    pub index: u8,
    pub amount_lamports: u64,
    pub proof: Vec<[u8; 32]>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct Claim<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PrizeConfig>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, PrizeVault>,

    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,

    /// The winner signs for their own prize; nobody can claim it for them.
    #[account(mut)]
    pub winner: Signer<'info>,
}

impl<'info> Claim<'info> {
    pub fn process(ctx: Context<Self>, season_id: u32, args: ClaimArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let season = &mut ctx.accounts.season;
        require!(season.is_finalized(), PrizeError::NotFinalized);
        // No deadline: a prize waits for its winner however long that takes (D-0102).
        require!(now >= season.claims_open_at, PrizeError::ClaimsNotOpen);
        require!(args.index < season.winners, PrizeError::InvalidIndex);
        require!(!season.has_claimed(args.index), PrizeError::AlreadyClaimed);
        require!(args.proof.len() <= MAX_PROOF_LEN, PrizeError::ProofTooLong);
        require!(args.amount_lamports > 0, PrizeError::InvalidAmount);

        let cap = (season.funded_lamports as u128 * MAX_PRIZE_BPS as u128 / BPS_DENOMINATOR as u128)
            as u64;
        require!(args.amount_lamports <= cap, PrizeError::PrizeTooLarge);

        let leaf = merkle::leaf(
            season_id,
            args.index,
            &ctx.accounts.winner.key(),
            args.amount_lamports,
        );
        require!(
            merkle::verify(&args.proof, &season.winners_root, leaf),
            PrizeError::InvalidProof
        );

        let claimed = season
            .claimed_lamports
            .checked_add(args.amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;
        require!(
            claimed <= season.prizes_lamports,
            PrizeError::ClaimsOverPrizes
        );
        season.claimed_lamports = claimed;
        season.claimed_bitmap |= 1u64 << args.index;

        let config = &mut ctx.accounts.config;
        config.reserved_lamports = config
            .reserved_lamports
            .checked_sub(args.amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;
        config.paid_lamports = config
            .paid_lamports
            .checked_add(args.amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;

        // The vault is owned by this program, so it can move its lamports directly.
        let vault = ctx.accounts.vault.to_account_info();
        let winner = ctx.accounts.winner.to_account_info();
        **vault.try_borrow_mut_lamports()? = vault
            .lamports()
            .checked_sub(args.amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;
        **winner.try_borrow_mut_lamports()? = winner
            .lamports()
            .checked_add(args.amount_lamports)
            .ok_or(PrizeError::MathOverflow)?;

        emit!(PrizeClaimed {
            season_id,
            index: args.index,
            winner: winner.key(),
            amount_lamports: args.amount_lamports,
        });
        Ok(())
    }
}
