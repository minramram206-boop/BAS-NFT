use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
use crate::errors::MarketError;
use crate::events::ListingCancelled;
use crate::state::Listing;

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.asset.as_ref()],
        bump = listing.bump,
        has_one = seller @ MarketError::Unauthorized,
        close = seller
    )]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub seller: Signer<'info>,
}

impl<'info> CancelListing<'info> {
    /// Allowed while paused and whether or not the seller still holds the
    /// asset. The client sends Core's `RevokePluginAuthorityV1` in the same
    /// transaction so the market stops being the delegate.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        emit!(ListingCancelled {
            asset: ctx.accounts.listing.asset,
            seller: ctx.accounts.seller.key(),
        });
        Ok(())
    }
}
