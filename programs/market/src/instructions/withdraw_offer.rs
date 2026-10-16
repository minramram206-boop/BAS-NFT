use anchor_lang::prelude::*;

use crate::constants::OFFER_SEED;
use crate::errors::MarketError;
use crate::events::OfferWithdrawn;
use crate::state::Offer;

#[derive(Accounts)]
pub struct WithdrawOffer<'info> {
    #[account(
        mut,
        seeds = [OFFER_SEED, offer.asset.as_ref(), buyer.key().as_ref()],
        bump = offer.bump,
        has_one = buyer @ MarketError::Unauthorized,
        close = buyer
    )]
    pub offer: Account<'info, Offer>,

    #[account(mut)]
    pub buyer: Signer<'info>,
}

impl<'info> WithdrawOffer<'info> {
    /// The buyer takes the offer back, open or expired: closing the account
    /// returns the offered SOL and the rent. Works while the market is paused,
    /// so no offer is ever held against the buyer's will.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        emit!(OfferWithdrawn {
            asset: offer.asset,
            buyer: offer.buyer,
            amount_lamports: offer.amount_lamports,
            expired: false,
        });
        Ok(())
    }
}
