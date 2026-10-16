use anchor_lang::prelude::*;

use crate::constants::OFFER_SEED;
use crate::errors::MarketError;
use crate::events::OfferWithdrawn;
use crate::state::Offer;

#[derive(Accounts)]
pub struct CloseExpiredOffer<'info> {
    #[account(
        mut,
        seeds = [OFFER_SEED, offer.asset.as_ref(), buyer.key().as_ref()],
        bump = offer.bump,
        has_one = buyer @ MarketError::Unauthorized,
        close = buyer
    )]
    pub offer: Account<'info, Offer>,

    /// CHECK: the offer's buyer, tied by `has_one`; gets the SOL and the rent back.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,

    /// Anyone. Pays the transaction and receives nothing.
    pub caller: Signer<'info>,
}

impl<'info> CloseExpiredOffer<'info> {
    /// After its end anyone may close an offer, which pays everything back to
    /// the buyer, so SOL never stays locked in an offer nobody can accept.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        require!(
            !offer.is_open(Clock::get()?.unix_timestamp),
            MarketError::OfferNotExpired
        );
        emit!(OfferWithdrawn {
            asset: offer.asset,
            buyer: offer.buyer,
            amount_lamports: offer.amount_lamports,
            expired: true,
        });
        Ok(())
    }
}
