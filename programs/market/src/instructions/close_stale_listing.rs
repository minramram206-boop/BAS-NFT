use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, LISTING_SEED};
use crate::core_asset;
use crate::errors::MarketError;
use crate::events::StaleListingClosed;
use crate::pda;
use crate::state::{Listing, MarketConfig};

#[derive(Accounts)]
pub struct CloseStaleListing<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(
        mut,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump = listing.bump,
        has_one = seller @ MarketError::Unauthorized,
        close = seller
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: the listing's seeds tie it to this address. It may have been
    /// burned, so it is not required to still be a Core asset.
    pub asset: UncheckedAccount<'info>,

    /// CHECK: the listing's seller, who gets the rent back.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    /// Anyone. The next owner usually sends this before listing the citizen again.
    pub caller: Signer<'info>,
}

impl<'info> CloseStaleListing<'info> {
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let config = &ctx.accounts.config;
        let listing = &ctx.accounts.listing;

        let stale = if core_asset::is_live_asset(&ctx.accounts.asset) {
            let asset = core_asset::load_core_asset(&ctx.accounts.asset)?;
            let authority = pda::authority_from_bump(config.authority_bump)?;
            asset.owner != listing.seller
                || asset.collection != config.collection
                || !asset.delegates_transfer_to(&authority)
        } else {
            true
        };
        require!(stale, MarketError::ListingNotStale);

        emit!(StaleListingClosed {
            asset: listing.asset,
            seller: listing.seller,
            closed_by: ctx.accounts.caller.key(),
        });
        Ok(())
    }
}
