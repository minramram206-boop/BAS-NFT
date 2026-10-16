//! Events for the worker and indexers. A sale is the one the public history
//! of a citizen cares about; the rest let a reader rebuild the listing set.

use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub collection: Pubkey,
    pub royalty_bps: u16,
    pub royalty_recipient: Pubkey,
    pub fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub is_paused: bool,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub royalty_bps: u16,
    pub royalty_recipient: Pubkey,
    pub fee_bps: u16,
    pub fee_recipient: Pubkey,
}

#[event]
pub struct PauseStateChanged {
    pub admin: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AdminProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
}

#[event]
pub struct AdminAccepted {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct Listed {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub price_lamports: u64,
}

#[event]
pub struct PriceUpdated {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub previous_price_lamports: u64,
    pub price_lamports: u64,
}

#[event]
pub struct ListingCancelled {
    pub asset: Pubkey,
    pub seller: Pubkey,
}

#[event]
pub struct StaleListingClosed {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub closed_by: Pubkey,
}

#[event]
pub struct Sold {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price_lamports: u64,
    pub royalty_lamports: u64,
    pub fee_lamports: u64,
    pub seller_lamports: u64,
}

#[event]
pub struct AuctionCreated {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub start_price_lamports: u64,
    pub ends_at: i64,
}

#[event]
pub struct BidPlaced {
    pub asset: Pubkey,
    pub bidder: Pubkey,
    pub amount_lamports: u64,
    /// `Pubkey::default()` for the first bid.
    pub previous_bidder: Pubkey,
    /// Paid back to `previous_bidder` in the same instruction.
    pub refunded_lamports: u64,
    pub ends_at: i64,
}

#[event]
pub struct AuctionCancelled {
    pub asset: Pubkey,
    pub seller: Pubkey,
}

/// The end of an auction. `delivered` is true when the asset went to the
/// winner and the seller was paid; otherwise any bid was paid back and the
/// asset is back with the seller.
#[event]
pub struct AuctionSettled {
    pub asset: Pubkey,
    pub seller: Pubkey,
    /// `Pubkey::default()` when there was no bid.
    pub winner: Pubkey,
    pub price_lamports: u64,
    pub royalty_lamports: u64,
    pub fee_lamports: u64,
    pub seller_lamports: u64,
    pub delivered: bool,
}

/// A new offer, or a replaced one: `previous_amount_lamports` (zero for a new
/// one) went back to the buyer in the same instruction.
#[event]
pub struct OfferMade {
    pub asset: Pubkey,
    pub buyer: Pubkey,
    pub amount_lamports: u64,
    pub previous_amount_lamports: u64,
    pub expires_at: i64,
}

/// An offer closed without a sale; its SOL went back to the buyer. `expired`
/// is true when someone other than the buyer closed it after its end.
#[event]
pub struct OfferWithdrawn {
    pub asset: Pubkey,
    pub buyer: Pubkey,
    pub amount_lamports: u64,
    pub expired: bool,
}

#[event]
pub struct OfferAccepted {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price_lamports: u64,
    pub royalty_lamports: u64,
    pub fee_lamports: u64,
    pub seller_lamports: u64,
}
