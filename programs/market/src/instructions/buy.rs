use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::{AUTHORITY_SEED, CONFIG_SEED, LISTING_SEED};
use crate::core_asset::{self, TransferAccounts, MPL_CORE_PROGRAM_ID};
use crate::errors::MarketError;
use crate::events::Sold;
use crate::sale::split_sale;
use crate::state::{Listing, MarketConfig};

#[derive(Accounts)]
pub struct Buy<'info> {
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

    /// CHECK: the listing's seeds tie it to this address; read as a Core
    /// asset in the handler and written by Core.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Core requires the asset's collection on every transfer.
    #[account(address = config.collection @ MarketError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: the listing's seller; receives the proceeds and the listing rent.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: fixed by the config.
    #[account(mut, address = config.royalty_recipient @ MarketError::InvalidConfig)]
    pub royalty_recipient: UncheckedAccount<'info>,

    /// CHECK: fixed by the config. Receives nothing while `fee_bps` is 0.
    #[account(mut, address = config.fee_recipient @ MarketError::InvalidConfig)]
    pub fee_recipient: UncheckedAccount<'info>,

    /// CHECK: PDA with no data; the asset's transfer delegate.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// CHECK: address checked.
    #[account(address = MPL_CORE_PROGRAM_ID @ MarketError::InvalidAsset)]
    pub core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Buy<'info> {
    /// Pays the seller, the royalty and the fee from the buyer, moves the
    /// asset to the buyer as the market's delegate and closes the listing.
    /// Every step is in one instruction, so either all of it happens or none.
    ///
    /// `max_price_lamports` is the price the buyer saw. If the seller raised
    /// it in the meantime the purchase fails instead of charging more.
    pub fn process(ctx: Context<Self>, max_price_lamports: u64) -> Result<()> {
        let accounts = &ctx.accounts;
        let config = &accounts.config;
        let listing = &accounts.listing;
        let buyer = accounts.buyer.key();

        require!(!config.is_paused, MarketError::MarketPaused);
        require!(
            listing.price_lamports <= max_price_lamports,
            MarketError::PriceAboveLimit
        );
        require_keys_neq!(buyer, listing.seller, MarketError::BuyerIsSeller);

        let asset = core_asset::load_core_asset(&accounts.asset)?;
        require_keys_eq!(
            asset.collection,
            config.collection,
            MarketError::WrongCollection
        );
        require!(
            asset.owner == listing.seller
                && asset.delegates_transfer_to(accounts.market_authority.key),
            MarketError::ListingStale
        );
        require!(!asset.is_frozen(), MarketError::AssetFrozen);

        let split = split_sale(listing.price_lamports, config.royalty_bps, config.fee_bps)
            .ok_or_else(|| error!(MarketError::Overflow))?;
        for (recipient, lamports) in [
            (&accounts.seller, split.seller_lamports),
            (&accounts.royalty_recipient, split.royalty_lamports),
            (&accounts.fee_recipient, split.fee_lamports),
        ] {
            if lamports > 0 {
                pay(accounts, recipient, lamports)?;
            }
        }

        core_asset::transfer(
            TransferAccounts {
                core_program: &accounts.core_program,
                asset: &accounts.asset,
                collection: &accounts.collection,
                payer: &accounts.buyer,
                authority: &accounts.market_authority,
                new_owner: &accounts.buyer,
                system_program: &accounts.system_program,
            },
            &[AUTHORITY_SEED, &[config.authority_bump]],
        )?;

        // Core is trusted to have done this, but a wrong owner here would
        // mean the buyer paid for nothing, so it is checked rather than assumed.
        let moved = core_asset::load_core_asset(&accounts.asset)?;
        require_keys_eq!(moved.owner, buyer, MarketError::ListingStale);

        emit!(Sold {
            asset: listing.asset,
            seller: listing.seller,
            buyer,
            price_lamports: listing.price_lamports,
            royalty_lamports: split.royalty_lamports,
            fee_lamports: split.fee_lamports,
            seller_lamports: split.seller_lamports,
        });
        Ok(())
    }
}

fn pay<'info>(
    accounts: &Buy<'info>,
    recipient: &UncheckedAccount<'info>,
    lamports: u64,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            accounts.system_program.to_account_info(),
            Transfer {
                from: accounts.buyer.to_account_info(),
                to: recipient.to_account_info(),
            },
        ),
        lamports,
    )
}
