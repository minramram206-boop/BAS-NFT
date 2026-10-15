use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::{AUCTION_SEED, AUTHORITY_SEED, CONFIG_SEED, MAX_PRICE_LAMPORTS};
use crate::core_asset;
use crate::errors::MarketError;
use crate::events::BidPlaced;
use crate::sale::{end_after_bid, min_next_bid};
use crate::state::{move_lamports, Auction, MarketConfig};

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(mut, seeds = [AUCTION_SEED, auction.asset.as_ref()], bump = auction.bump)]
    pub auction: Account<'info, Auction>,

    /// CHECK: the auction's asset, read to check the market can still deliver it.
    #[account(address = auction.asset @ MarketError::InvalidAsset)]
    pub asset: UncheckedAccount<'info>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    /// CHECK: the current highest bidder, paid back here. Absent for the first bid.
    #[account(mut)]
    pub previous_bidder: Option<UncheckedAccount<'info>>,

    /// CHECK: PDA with no data; the asset's delegate.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> PlaceBid<'info> {
    /// Takes `amount_lamports` from the bidder into the auction account and,
    /// in the same instruction, pays the previous highest bid back in full.
    /// The auction therefore only ever holds one bid.
    pub fn process(ctx: Context<Self>, amount_lamports: u64) -> Result<()> {
        let accounts = &ctx.accounts;
        let auction = &accounts.auction;
        let bidder = accounts.bidder.key();
        let now = Clock::get()?.unix_timestamp;

        require!(!accounts.config.is_paused, MarketError::MarketPaused);
        require!(now < auction.ends_at, MarketError::AuctionEnded);
        require_keys_neq!(bidder, auction.seller, MarketError::BuyerIsSeller);
        require!(
            !(auction.has_bids() && bidder == auction.highest_bidder),
            MarketError::AlreadyHighestBidder
        );
        let minimum = min_next_bid(
            auction.start_price_lamports,
            auction.highest_bid_lamports,
            auction.has_bids(),
        )
        .ok_or_else(|| error!(MarketError::Overflow))?;
        require!(amount_lamports >= minimum, MarketError::BidTooLow);
        require!(amount_lamports <= MAX_PRICE_LAMPORTS, MarketError::PriceOutOfRange);

        let asset = core_asset::load_core_asset(&accounts.asset)?;
        require!(
            auction.can_deliver(&asset, accounts.market_authority.key),
            MarketError::AuctionUndeliverable
        );

        system_program::transfer(
            CpiContext::new(
                accounts.system_program.to_account_info(),
                Transfer {
                    from: accounts.bidder.to_account_info(),
                    to: accounts.auction.to_account_info(),
                },
            ),
            amount_lamports,
        )?;

        let (previous_bidder, refunded) = if auction.has_bids() {
            let previous = accounts
                .previous_bidder
                .as_ref()
                .ok_or_else(|| error!(MarketError::WrongBidder))?;
            require_keys_eq!(previous.key(), auction.highest_bidder, MarketError::WrongBidder);
            move_lamports(
                &accounts.auction.to_account_info(),
                &previous.to_account_info(),
                auction.highest_bid_lamports,
            )?;
            (auction.highest_bidder, auction.highest_bid_lamports)
        } else {
            (Pubkey::default(), 0)
        };

        let auction = &mut ctx.accounts.auction;
        auction.highest_bid_lamports = amount_lamports;
        auction.highest_bidder = bidder;
        auction.bid_count = auction
            .bid_count
            .checked_add(1)
            .ok_or_else(|| error!(MarketError::Overflow))?;
        auction.ends_at = end_after_bid(auction.ends_at, now);

        emit!(BidPlaced {
            asset: auction.asset,
            bidder,
            amount_lamports,
            previous_bidder,
            refunded_lamports: refunded,
            ends_at: auction.ends_at,
        });
        Ok(())
    }
}
