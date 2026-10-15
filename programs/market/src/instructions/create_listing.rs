use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, LISTING_SEED, LISTING_VERSION};
use crate::core_asset::{self, CoreAsset};
use crate::errors::MarketError;
use crate::events::Listed;
use crate::pda;
use crate::sale::price_in_range;
use crate::state::{Listing, MarketConfig};

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    /// One listing per asset. A listing left behind by a previous owner has
    /// to go through `close_stale_listing` first.
    #[account(
        init,
        payer = seller,
        space = Listing::LEN,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: read as a Core asset in the handler.
    pub asset: UncheckedAccount<'info>,

    /// Owner of the asset; pays the listing rent and gets it back on close.
    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CreateListing<'info> {
    /// The client sends Core's `AddPluginV1` (or `ApprovePluginAuthorityV1`
    /// when the plugin already exists) in the same transaction, before this
    /// instruction, so the delegate is in place when it is checked here.
    pub fn process(ctx: Context<Self>, price_lamports: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.is_paused, MarketError::MarketPaused);
        require!(price_in_range(price_lamports), MarketError::PriceOutOfRange);

        let seller = ctx.accounts.seller.key();
        let asset = core_asset::load_core_asset(&ctx.accounts.asset)?;
        require_listable(&asset, config, &seller)?;
        // A frozen asset cannot be sold; an auctioned one is frozen until it ends.
        require!(!asset.is_frozen(), MarketError::AssetFrozen);

        let listing = &mut ctx.accounts.listing;
        listing.set_inner(Listing {
            version: LISTING_VERSION,
            asset: ctx.accounts.asset.key(),
            seller,
            price_lamports,
            listed_at: Clock::get()?.unix_timestamp,
            bump: ctx.bumps.listing,
        });

        emit!(Listed {
            asset: listing.asset,
            seller,
            price_lamports,
        });
        Ok(())
    }
}

/// The asset is in the market's collection, held by `seller`, and lets the
/// market's authority transfer it.
pub fn require_listable(asset: &CoreAsset, config: &MarketConfig, seller: &Pubkey) -> Result<()> {
    require_keys_eq!(
        asset.collection,
        config.collection,
        MarketError::WrongCollection
    );
    require_keys_eq!(asset.owner, *seller, MarketError::NotOwner);
    require!(
        asset.delegates_transfer_to(&pda::authority_from_bump(config.authority_bump)?),
        MarketError::DelegateMissing
    );
    Ok(())
}
