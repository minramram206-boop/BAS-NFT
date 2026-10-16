use anchor_lang::prelude::*;

use crate::constants::{AUCTION_SEED, AUTHORITY_SEED, CONFIG_SEED};
use crate::core_asset::{self, FreezeAccounts, TransferAccounts, MPL_CORE_PROGRAM_ID};
use crate::errors::MarketError;
use crate::events::AuctionCancelled;
use crate::state::{Auction, MarketConfig};

#[derive(Accounts)]
pub struct CancelAuction<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.asset.as_ref()],
        bump = auction.bump,
        has_one = seller @ MarketError::Unauthorized,
        close = seller
    )]
    pub auction: Account<'info, Auction>,

    /// CHECK: the auction's asset; handed back, or thawed, by Core here.
    #[account(mut, address = auction.asset @ MarketError::InvalidAsset)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Core requires the asset's collection to update a plugin.
    #[account(mut, address = config.collection @ MarketError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,

    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: PDA with no data; holds the asset (or, for an older auction, freezes it).
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// CHECK: address checked.
    #[account(address = MPL_CORE_PROGRAM_ID @ MarketError::InvalidAsset)]
    pub core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CancelAuction<'info> {
    /// Only before the first bid, and also while the market is paused. The
    /// market hands the asset back to the seller. An auction started before
    /// the market held its asset is thawed instead, and the client revokes
    /// the market's delegates in the same transaction.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let accounts = &ctx.accounts;
        require!(!accounts.auction.has_bids(), MarketError::AuctionHasBids);
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, &[accounts.config.authority_bump]];

        let asset = core_asset::load_core_asset(&accounts.asset)?;
        if Auction::held_by_market(&asset, accounts.market_authority.key) {
            core_asset::transfer(
                TransferAccounts {
                    core_program: &accounts.core_program,
                    asset: &accounts.asset,
                    collection: &accounts.collection,
                    payer: &accounts.seller,
                    authority: &accounts.market_authority,
                    new_owner: &accounts.seller,
                    system_program: &accounts.system_program,
                },
                seeds,
            )?;
        } else if asset.is_frozen() && asset.freeze_held_by(accounts.market_authority.key) {
            core_asset::set_frozen(
                FreezeAccounts {
                    core_program: &accounts.core_program,
                    asset: &accounts.asset,
                    collection: &accounts.collection,
                    payer: &accounts.seller,
                    authority: &accounts.market_authority,
                    system_program: &accounts.system_program,
                },
                false,
                seeds,
            )?;
        }

        emit!(AuctionCancelled {
            asset: accounts.auction.asset,
            seller: accounts.auction.seller,
        });
        Ok(())
    }
}
