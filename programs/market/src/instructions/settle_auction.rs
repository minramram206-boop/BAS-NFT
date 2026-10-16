use anchor_lang::prelude::*;

use crate::constants::{AUCTION_SEED, AUTHORITY_SEED, CONFIG_SEED};
use crate::core_asset::{self, FreezeAccounts, TransferAccounts, MPL_CORE_PROGRAM_ID};
use crate::errors::MarketError;
use crate::events::AuctionSettled;
use crate::sale::split_sale;
use crate::state::{move_lamports, Auction, MarketConfig};

#[derive(Accounts)]
pub struct SettleAuction<'info> {
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

    /// CHECK: the auction's asset; handed to the winner or back to the seller by Core.
    #[account(mut, address = auction.asset @ MarketError::InvalidAsset)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Core requires the asset's collection.
    #[account(mut, address = config.collection @ MarketError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: the auction's seller; receives the proceeds and the auction rent.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: the highest bidder; receives the asset, or the bid back. Absent without bids.
    #[account(mut)]
    pub winner: Option<UncheckedAccount<'info>>,

    /// CHECK: fixed by the config.
    #[account(mut, address = config.royalty_recipient @ MarketError::InvalidConfig)]
    pub royalty_recipient: UncheckedAccount<'info>,

    /// CHECK: fixed by the config.
    #[account(mut, address = config.fee_recipient @ MarketError::InvalidConfig)]
    pub fee_recipient: UncheckedAccount<'info>,

    /// CHECK: PDA with no data; holds the asset (or, for an older auction, is its delegate).
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// CHECK: address checked.
    #[account(address = MPL_CORE_PROGRAM_ID @ MarketError::InvalidAsset)]
    pub core_program: UncheckedAccount<'info>,

    /// Anyone: the winner, the seller, or a stranger. Pays the transaction.
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> SettleAuction<'info> {
    /// After the end: the asset goes to the highest bidder and the bid is
    /// split between seller, royalty and fee, or, without a bid, the asset goes
    /// back to the seller. Works while the market is paused, so no bid can be
    /// held forever.
    ///
    /// An auction started before the market held its asset keeps its older
    /// path: the asset is thawed in the seller's wallet, and when the market
    /// can no longer deliver it (the seller revoked a delegate), the highest
    /// bid is paid back instead, which may happen before the end.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let accounts = &ctx.accounts;
        let auction = &accounts.auction;
        let authority = accounts.market_authority.key;
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, &[accounts.config.authority_bump]];
        let now = Clock::get()?.unix_timestamp;

        let asset = if core_asset::is_live_asset(&accounts.asset) {
            core_asset::load_core_asset(&accounts.asset).ok()
        } else {
            None
        };
        let held = asset.is_some_and(|asset| Auction::held_by_market(&asset, authority));
        let deliverable = asset.is_some_and(|asset| auction.can_deliver(&asset, authority));
        require!(
            now >= auction.ends_at || (auction.has_bids() && !deliverable),
            MarketError::AuctionNotEnded
        );

        let winner = if auction.has_bids() {
            let winner = accounts
                .winner
                .as_ref()
                .ok_or_else(|| error!(MarketError::WrongBidder))?;
            require_keys_eq!(winner.key(), auction.highest_bidder, MarketError::WrongBidder);
            Some(winner)
        } else {
            None
        };

        if asset.is_some_and(|asset| asset.is_frozen() && asset.freeze_held_by(authority)) {
            core_asset::set_frozen(
                FreezeAccounts {
                    core_program: &accounts.core_program,
                    asset: &accounts.asset,
                    collection: &accounts.collection,
                    payer: &accounts.caller,
                    authority: &accounts.market_authority,
                    system_program: &accounts.system_program,
                },
                false,
                seeds,
            )?;
        }

        let price = auction.highest_bid_lamports;
        let auction_info = accounts.auction.to_account_info();
        let mut event = AuctionSettled {
            asset: auction.asset,
            seller: auction.seller,
            winner: auction.highest_bidder,
            price_lamports: price,
            royalty_lamports: 0,
            fee_lamports: 0,
            seller_lamports: 0,
            delivered: false,
        };

        match winner {
            Some(winner) if deliverable => {
                core_asset::transfer(
                    TransferAccounts {
                        core_program: &accounts.core_program,
                        asset: &accounts.asset,
                        collection: &accounts.collection,
                        payer: &accounts.caller,
                        authority: &accounts.market_authority,
                        new_owner: winner,
                        system_program: &accounts.system_program,
                    },
                    seeds,
                )?;
                let moved = core_asset::load_core_asset(&accounts.asset)?;
                require_keys_eq!(moved.owner, winner.key(), MarketError::AuctionUndeliverable);

                let split = split_sale(price, accounts.config.royalty_bps, accounts.config.fee_bps)
                    .ok_or_else(|| error!(MarketError::Overflow))?;
                move_lamports(&auction_info, &accounts.seller, split.seller_lamports)?;
                move_lamports(&auction_info, &accounts.royalty_recipient, split.royalty_lamports)?;
                move_lamports(&auction_info, &accounts.fee_recipient, split.fee_lamports)?;
                event.royalty_lamports = split.royalty_lamports;
                event.fee_lamports = split.fee_lamports;
                event.seller_lamports = split.seller_lamports;
                event.delivered = true;
            }
            Some(winner) => move_lamports(&auction_info, winner, price)?,
            None if held => core_asset::transfer(
                TransferAccounts {
                    core_program: &accounts.core_program,
                    asset: &accounts.asset,
                    collection: &accounts.collection,
                    payer: &accounts.caller,
                    authority: &accounts.market_authority,
                    new_owner: &accounts.seller,
                    system_program: &accounts.system_program,
                },
                seeds,
            )?,
            None => {}
        }

        emit!(event);
        Ok(())
    }
}
