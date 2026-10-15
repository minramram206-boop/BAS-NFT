use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, LISTING_SEED};
use crate::core_asset;
use crate::errors::MarketError;
use crate::events::PriceUpdated;
use crate::pda;
use crate::sale::price_in_range;
use crate::state::{Listing, MarketConfig};

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(
        mut,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump = listing.bump,
        has_one = seller @ MarketError::Unauthorized
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: the listing's seeds tie it to this address; read as a Core asset.
    pub asset: UncheckedAccount<'info>,

    pub seller: Signer<'info>,
}

impl<'info> UpdatePrice<'info> {
    /// A buyer who signed at the old price is protected by `buy`'s
    /// `max_price_lamports`, so a raise cannot catch them mid-flight.
    pub fn process(ctx: Context<Self>, price_lamports: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.is_paused, MarketError::MarketPaused);
        require!(price_in_range(price_lamports), MarketError::PriceOutOfRange);
        let listing = &mut ctx.accounts.listing;
        require!(
            price_lamports != listing.price_lamports,
            MarketError::PriceUnchanged
        );

        let asset = core_asset::load_core_asset(&ctx.accounts.asset)?;
        require!(
            asset.owner == listing.seller
                && asset.delegates_transfer_to(&pda::authority_from_bump(config.authority_bump)?),
            MarketError::ListingStale
        );

        let previous_price_lamports = listing.price_lamports;
        listing.price_lamports = price_lamports;

        emit!(PriceUpdated {
            asset: listing.asset,
            seller: listing.seller,
            previous_price_lamports,
            price_lamports,
        });
        Ok(())
    }
}
