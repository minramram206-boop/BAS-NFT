use anchor_lang::prelude::*;

/// Program errors, numbered from 6000 in declaration order. New variants go
/// at the end so existing codes keep their numbers; the web client maps them.
///
/// A second listing for the same asset is refused by `init` before any
/// handler runs, so clients see the system program's `AccountAlreadyInUse`.
#[error_code]
pub enum MarketError {
    #[msg("Caller is not authorized.")]
    Unauthorized,

    #[msg("The market is paused.")]
    MarketPaused,

    #[msg("Configuration value is out of range.")]
    InvalidConfig,

    #[msg("Price is outside the allowed range.")]
    PriceOutOfRange,

    #[msg("Account is not an uncompressed Core asset in a collection.")]
    InvalidAsset,

    #[msg("Asset does not belong to the market's collection.")]
    WrongCollection,

    #[msg("Signer does not own the asset.")]
    NotOwner,

    #[msg("The market is not the asset's transfer delegate.")]
    DelegateMissing,

    #[msg("The listing is no longer valid: the asset moved or the delegate was removed.")]
    ListingStale,

    #[msg("The listing is still valid and can only be closed by its seller.")]
    ListingNotStale,

    #[msg("The listed price is above the buyer's limit.")]
    PriceAboveLimit,

    #[msg("A seller cannot buy their own listing.")]
    BuyerIsSeller,

    #[msg("The new price equals the current price.")]
    PriceUnchanged,

    #[msg("A payment recipient does not hold enough SOL to stay rent exempt.")]
    RecipientNotFunded,

    #[msg("Arithmetic overflow.")]
    Overflow,

    #[msg("The asset is frozen.")]
    AssetFrozen,

    #[msg("An auction runs for 24, 48 or 72 hours.")]
    InvalidDuration,

    /// Raised by auctions that froze the asset in the seller's wallet, which
    /// are no longer created (D-0092). Kept so the codes after it stay put.
    #[msg("The market does not hold the asset's freeze delegate.")]
    FreezeMissing,

    #[msg("The asset is listed for a fixed price; cancel the listing first.")]
    ListingExists,

    #[msg("The auction has ended.")]
    AuctionEnded,

    #[msg("The auction has not ended yet.")]
    AuctionNotEnded,

    #[msg("The bid is lower than the auction accepts.")]
    BidTooLow,

    #[msg("The auction already has a bid and cannot be cancelled.")]
    AuctionHasBids,

    #[msg("You already hold the highest bid.")]
    AlreadyHighestBidder,

    #[msg("The previous highest bidder account is missing or wrong.")]
    WrongBidder,

    #[msg("The market can no longer deliver this asset: the seller moved it or removed a delegate.")]
    AuctionUndeliverable,

    #[msg("An offer stays open for 1, 3 or 7 days.")]
    InvalidOfferLength,

    #[msg("The citizen is at auction; bid on it instead.")]
    AssetInAuction,

    #[msg("The offer has expired.")]
    OfferExpired,

    #[msg("The offer is still open and can only be closed by its buyer.")]
    OfferNotExpired,

    #[msg("The offer changed since it was shown.")]
    OfferChanged,
}
