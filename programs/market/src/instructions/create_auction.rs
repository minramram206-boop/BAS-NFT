use anchor_lang::prelude::*;

use crate::constants::{AUCTION_SEED, AUCTION_VERSION, AUTHORITY_SEED, CONFIG_SEED, LISTING_SEED};
use crate::core_asset::{self, FreezeAccounts, MPL_CORE_PROGRAM_ID};
use crate::errors::MarketError;
use crate::events::AuctionCreated;
use crate::instructions::create_listing::require_listable;
use crate::sale::{auction_seconds, price_in_range};
use crate::state::{Auction, MarketConfig};

#[derive(Accounts)]
pub struct CreateAuction<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(
        init,
        payer = seller,
        space = Auction::LEN,
        seeds = [AUCTION_SEED, asset.key().as_ref()],
        bump
    )]
    pub auction: Account<'info, Auction>,

    /// CHECK: the asset's fixed-price listing address. It must be empty: one
    /// citizen is either listed or auctioned, never both.
    #[account(seeds = [LISTING_SEED, asset.key().as_ref()], bump)]
    pub listing: UncheckedAccount<'info>,

    /// CHECK: read as a Core asset in the handler and written by Core.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Core requires the asset's collection to update a plugin.
    #[account(mut, address = config.collection @ MarketError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,

    /// Owner of the asset; pays the auction rent and gets it back at the end.
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: PDA with no data; the asset's transfer and freeze delegate.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// CHECK: address checked.
    #[account(address = MPL_CORE_PROGRAM_ID @ MarketError::InvalidAsset)]
    pub core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CreateAuction<'info> {
    /// The client sends Core's plugin instructions earlier in the same
    /// transaction, so the market holds both the TransferDelegate and an
    /// unfrozen FreezeDelegate when this runs. This instruction then freezes
    /// the asset: from here until the end, neither the seller nor anyone else
    /// can move or burn it.
    pub fn process(ctx: Context<Self>, start_price_lamports: u64, duration_hours: u8) -> Result<()> {
        let accounts = &ctx.accounts;
        let config = &accounts.config;
        require!(!config.is_paused, MarketError::MarketPaused);
        require!(price_in_range(start_price_lamports), MarketError::PriceOutOfRange);
        let duration = auction_seconds(duration_hours).ok_or_else(|| error!(MarketError::InvalidDuration))?;
        require!(accounts.listing.data_is_empty(), MarketError::ListingExists);

        let seller = accounts.seller.key();
        let asset = core_asset::load_core_asset(&accounts.asset)?;
        require_listable(&asset, config, &seller)?;
        require!(!asset.is_frozen(), MarketError::AssetFrozen);
        require!(
            asset.freeze_held_by(accounts.market_authority.key),
            MarketError::FreezeMissing
        );

        core_asset::set_frozen(
            FreezeAccounts {
                core_program: &accounts.core_program,
                asset: &accounts.asset,
                collection: &accounts.collection,
                payer: &accounts.seller,
                authority: &accounts.market_authority,
                system_program: &accounts.system_program,
            },
            true,
            &[AUTHORITY_SEED, &[config.authority_bump]],
        )?;
        let frozen = core_asset::load_core_asset(&accounts.asset)?;
        require!(frozen.is_frozen(), MarketError::FreezeMissing);

        // Says in every transaction log that this binary runs the fast clock;
        // the deploy script also looks for this text in the binary.
        #[cfg(feature = "devnet-clock")]
        msg!("BAS devnet auction clock: one auction hour lasts 10 seconds");

        let now = Clock::get()?.unix_timestamp;
        let ends_at = now.checked_add(duration).ok_or_else(|| error!(MarketError::Overflow))?;
        let auction = &mut ctx.accounts.auction;
        auction.set_inner(Auction {
            version: AUCTION_VERSION,
            asset: ctx.accounts.asset.key(),
            seller,
            start_price_lamports,
            highest_bid_lamports: 0,
            highest_bidder: Pubkey::default(),
            started_at: now,
            ends_at,
            bid_count: 0,
            bump: ctx.bumps.auction,
        });

        emit!(AuctionCreated {
            asset: auction.asset,
            seller,
            start_price_lamports,
            ends_at,
        });
        Ok(())
    }
}
