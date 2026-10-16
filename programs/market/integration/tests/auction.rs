//! Auctions against the Core program: the market holds the citizen from the
//! start, bids are held by the auction and paid back when outbid, and
//! settling moves the citizen and the money in one instruction. The seller
//! may take the citizen back only before the first bid.
//!
//! The last tests cover auctions started before the market held the citizen
//! (frozen in the seller's wallet), which must still settle.

use market::constants::{AUCTION_EXTENSION_SECONDS, AUCTION_HOUR_SECONDS};
use market::errors::MarketError;
use market_integration::{
    auction_rent, expect_market_error, market_with_citizen, mpl_core::types::PluginType, World, SOL,
};
use solana_sdk::{pubkey::Pubkey, signer::Signer};

const START: u64 = SOL / 10;

async fn auctioned() -> (World, Pubkey) {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.start_auction(&asset, &seller, START, 24).await.expect("start an auction");
    (world, asset)
}

async fn legacy_auctioned() -> (World, Pubkey) {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.legacy_auction(&asset, &seller, START, 24).await;
    (world, asset)
}

#[tokio::test]
async fn the_market_holds_the_citizen_while_it_is_auctioned() {
    let (mut world, asset) = auctioned().await;
    let authority = world.authority_key();
    let seller = world.seller.insecure_clone();

    assert_eq!(world.owner_of(&asset).await, authority);
    assert_eq!(world.freeze_state(&asset).await, None, "nothing is frozen");
    let auction = world.auction(&asset).await.expect("auction");
    assert_eq!(auction.seller, seller.pubkey());
    assert_eq!(auction.start_price_lamports, START);
    assert_eq!(auction.bid_count, 0);
    assert_eq!(auction.ends_at - auction.started_at, 24 * AUCTION_HOUR_SECONDS);

    // The seller no longer owns it: no transfer, no burn, no listing, no revoke.
    let stranger = world.stranger.pubkey();
    assert!(world.core_transfer(&asset, &seller, &stranger).await.is_err());
    assert!(world.core_burn(&asset, &seller).await.is_err());
    let revoke = world.revoke_ix(&asset, &seller.pubkey(), PluginType::TransferDelegate);
    assert!(world.send(&[revoke], &[&seller]).await.is_err());
    let listing = world.create_listing_ix(&asset, &seller.pubkey(), SOL);
    expect_market_error(world.send(&[listing], &[&seller]).await, MarketError::NotOwner);
}

#[tokio::test]
async fn a_frozen_citizen_cannot_be_auctioned() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.core_freeze(&asset, &seller).await.expect("freeze");
    expect_market_error(world.start_auction(&asset, &seller, START, 24).await, MarketError::AssetFrozen);
}

#[tokio::test]
async fn only_the_owner_can_auction_a_citizen() {
    let (mut world, asset) = market_with_citizen().await;
    let stranger = world.stranger.insecure_clone();
    expect_market_error(world.start_auction(&asset, &stranger, START, 24).await, MarketError::NotOwner);
}

#[tokio::test]
async fn bids_are_held_and_paid_back_and_the_winner_gets_the_citizen() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let auction_key = world.auction_key(&asset);

    expect_market_error(world.bid(&asset, &buyer, START - 1).await, MarketError::BidTooLow);
    expect_market_error(world.bid(&asset, &seller, START).await, MarketError::BuyerIsSeller);

    let buyer_before = world.balance(&buyer.pubkey()).await;
    world.bid(&asset, &buyer, START).await.expect("first bid");
    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before - START);
    assert_eq!(world.balance(&auction_key).await, auction_rent() + START);
    expect_market_error(world.bid(&asset, &buyer, 2 * START).await, MarketError::AlreadyHighestBidder);

    // The next bid needs 5% more; one lamport less is refused.
    let second = START + START / 20;
    expect_market_error(world.bid(&asset, &stranger, second - 1).await, MarketError::BidTooLow);
    world.bid(&asset, &stranger, second).await.expect("outbid");
    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before, "the outbid bidder got everything back");
    assert_eq!(world.balance(&auction_key).await, auction_rent() + second, "the auction holds one bid");

    let third = 3 * START;
    world.bid(&asset, &buyer, third).await.expect("outbid again");
    let auction = world.auction(&asset).await.expect("auction");
    assert_eq!((auction.highest_bidder, auction.highest_bid_lamports, auction.bid_count), (buyer.pubkey(), third, 3));

    expect_market_error(world.settle(&asset, &stranger).await, MarketError::AuctionNotEnded);

    let ends_at = auction.ends_at;
    world.set_time(ends_at).await;
    expect_market_error(world.bid(&asset, &stranger, 4 * START).await, MarketError::AuctionEnded);

    let seller_before = world.balance(&seller.pubkey()).await;
    let treasury_before = world.balance(&world.treasury.pubkey()).await;
    world.set_time(ends_at).await;
    world.settle(&asset, &stranger).await.expect("anyone may settle");

    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
    let royalty = third / 20;
    assert_eq!(world.balance(&world.treasury.pubkey()).await - treasury_before, royalty);
    assert_eq!(
        world.balance(&seller.pubkey()).await - seller_before,
        third - royalty + auction_rent(),
        "the price less the royalty, plus the auction's rent"
    );
    assert!(world.account(&auction_key).await.is_none(), "the auction is closed");
    world.core_transfer(&asset, &buyer, &stranger.pubkey()).await.expect("the winner owns it outright");
}

#[tokio::test]
async fn a_late_bid_extends_the_auction_by_the_late_window() {
    let (mut world, asset) = auctioned().await;
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let ends_at = world.auction(&asset).await.expect("auction").ends_at;

    world.set_time(ends_at - 2 * AUCTION_EXTENSION_SECONDS).await;
    world.bid(&asset, &buyer, START).await.expect("an early bid");
    assert_eq!(world.auction(&asset).await.expect("auction").ends_at, ends_at);

    let late = ends_at - AUCTION_EXTENSION_SECONDS / 2;
    world.set_time(late).await;
    world.bid(&asset, &stranger, 2 * START).await.expect("a late bid");
    let extended = world.auction(&asset).await.expect("auction").ends_at;
    assert_eq!(extended, late + AUCTION_EXTENSION_SECONDS);

    world.set_time(ends_at + 1).await;
    world.bid(&asset, &buyer, 3 * START).await.expect("still open after the old end");
    world.set_time(extended).await;
    expect_market_error(world.settle(&asset, &stranger).await, MarketError::AuctionNotEnded);
}

#[tokio::test]
async fn the_seller_cancels_before_the_first_bid_and_gets_the_citizen_back() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let seller_before = world.balance(&seller.pubkey()).await;

    let by_stranger = world.cancel_auction_ix(&asset, &stranger.pubkey());
    expect_market_error(world.send(&[by_stranger], &[&stranger]).await, MarketError::Unauthorized);

    let cancel = world.cancel_auction_ix(&asset, &seller.pubkey());
    world.send(&[cancel], &[&seller]).await.expect("cancel");
    assert!(world.auction(&asset).await.is_none());
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
    assert_eq!(world.balance(&seller.pubkey()).await - seller_before, auction_rent());
    world.core_transfer(&asset, &seller, &stranger.pubkey()).await.expect("free to move again");
}

#[tokio::test]
async fn once_someone_has_bid_the_seller_cannot_stop_the_auction() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.bid(&asset, &buyer, START).await.expect("bid");

    let cancel = world.cancel_auction_ix(&asset, &seller.pubkey());
    expect_market_error(world.send(&[cancel], &[&seller]).await, MarketError::AuctionHasBids);
    // The old way out, revoking the delegate, does not exist: the seller owns nothing.
    let revoke = world.revoke_ix(&asset, &seller.pubkey(), PluginType::TransferDelegate);
    assert!(world.send(&[revoke], &[&seller]).await.is_err());
    // Nor can anyone settle early.
    expect_market_error(world.settle(&asset, &stranger).await, MarketError::AuctionNotEnded);

    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    world.set_time(ends_at).await;
    world.settle(&asset, &stranger).await.expect("settle");
    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
}

#[tokio::test]
async fn an_auction_without_bids_ends_with_the_citizen_back_home() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    let seller_before = world.balance(&seller.pubkey()).await;

    world.set_time(ends_at - 1).await;
    expect_market_error(world.settle(&asset, &stranger).await, MarketError::AuctionNotEnded);
    world.set_time(ends_at).await;
    world.settle(&asset, &stranger).await.expect("settle without bids");
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
    assert_eq!(world.balance(&seller.pubkey()).await - seller_before, auction_rent());
    assert!(world.auction(&asset).await.is_none());
}

#[tokio::test]
async fn the_refund_and_the_winner_must_be_the_recorded_bidder() {
    let (mut world, asset) = auctioned().await;
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.bid(&asset, &buyer, START).await.expect("bid");

    let missing = world.bid_ix(&asset, &stranger.pubkey(), 2 * START, None);
    expect_market_error(world.send(&[missing], &[&stranger]).await, MarketError::WrongBidder);
    let wrong = world.bid_ix(&asset, &stranger.pubkey(), 2 * START, Some(stranger.pubkey()));
    expect_market_error(world.send(&[wrong], &[&stranger]).await, MarketError::WrongBidder);

    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    world.set_time(ends_at).await;
    let seller = world.seller.pubkey();
    let thief = world.settle_ix(&asset, &seller, Some(stranger.pubkey()), &stranger.pubkey());
    expect_market_error(world.send(&[thief], &[&stranger]).await, MarketError::WrongBidder);
    let nobody = world.settle_ix(&asset, &seller, None, &stranger.pubkey());
    expect_market_error(world.send(&[nobody], &[&stranger]).await, MarketError::WrongBidder);
}

#[tokio::test]
async fn auctions_follow_the_market_rules() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let admin = world.admin.insecure_clone();

    for hours in [0u8, 12, 25, 96] {
        expect_market_error(world.start_auction(&asset, &seller, START, hours).await, MarketError::InvalidDuration);
    }
    expect_market_error(world.start_auction(&asset, &seller, 1_000, 24).await, MarketError::PriceOutOfRange);

    // Listed for a fixed price: no auction until the listing is cancelled.
    world.list(&asset, &seller, SOL).await.expect("list");
    expect_market_error(world.start_auction(&asset, &seller, START, 24).await, MarketError::ListingExists);
    let cancel = world.cancel_ix(&asset, &seller.pubkey());
    world.send(&[cancel], &[&seller]).await.expect("cancel listing");

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.expect("pause");
    expect_market_error(world.start_auction(&asset, &seller, START, 48).await, MarketError::MarketPaused);
    let open = world.set_paused_ix(&admin.pubkey(), false);
    world.send(&[open], &[&admin]).await.expect("open");
    world.start_auction(&asset, &seller, START, 72).await.expect("a 72 hour auction");
    let auction = world.auction(&asset).await.expect("auction");
    assert_eq!(auction.ends_at - auction.started_at, 72 * AUCTION_HOUR_SECONDS);
}

#[tokio::test]
async fn a_paused_market_takes_no_bids_but_still_settles_and_cancels() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let admin = world.admin.insecure_clone();
    let quiet = world.mint_into(world.collection, &seller.pubkey(), 14).await;
    world.start_auction(&quiet, &seller, START, 24).await.expect("a second auction");
    world.bid(&asset, &buyer, START).await.expect("bid");

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.expect("pause");
    expect_market_error(world.bid(&asset, &stranger, 2 * START).await, MarketError::MarketPaused);

    let cancel = world.cancel_auction_ix(&quiet, &seller.pubkey());
    world.send(&[cancel], &[&seller]).await.expect("cancel while paused");
    assert_eq!(world.owner_of(&quiet).await, seller.pubkey());

    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    world.set_time(ends_at).await;
    world.settle(&asset, &stranger).await.expect("settle while paused");
    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
}

#[tokio::test]
async fn the_winner_can_sell_again_by_listing_or_by_auction() {
    let (mut world, asset) = auctioned().await;
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.bid(&asset, &buyer, START).await.expect("bid");
    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    world.set_time(ends_at).await;
    world.settle(&asset, &stranger).await.expect("settle");

    world.start_auction(&asset, &buyer, START, 24).await.expect("auction it again");
    let authority = world.authority_key();
    assert_eq!(world.owner_of(&asset).await, authority);
    let cancel = world.cancel_auction_ix(&asset, &buyer.pubkey());
    world.send(&[cancel], &[&buyer]).await.expect("cancel");

    world.list(&asset, &buyer, SOL).await.expect("then list it");
    world.buy(&asset, &stranger, SOL).await.expect("and sell it");
    assert_eq!(world.owner_of(&asset).await, stranger.pubkey());
}

// --- auctions started before the market held the citizen ----------------------

#[tokio::test]
async fn an_older_auction_still_takes_bids_and_delivers_to_the_winner() {
    let (mut world, asset) = legacy_auctioned().await;
    let authority = world.authority_key();
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
    assert_eq!(world.freeze_state(&asset).await, Some((Some(authority), true)));

    world.bid(&asset, &buyer, START).await.expect("first bid");
    world.bid(&asset, &stranger, 2 * START).await.expect("outbid");
    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    world.set_time(ends_at).await;
    let seller_before = world.balance(&seller.pubkey()).await;
    world.settle(&asset, &buyer).await.expect("settle");

    assert_eq!(world.owner_of(&asset).await, stranger.pubkey());
    let royalty = 2 * START / 20;
    assert_eq!(world.balance(&seller.pubkey()).await - seller_before, 2 * START - royalty + auction_rent());
    // Thawed, and Core handed both delegates back to the new owner.
    let core = world.core_asset(&asset).await;
    let freeze = core.plugin_list.freeze_delegate.expect("freeze plugin");
    assert!(!freeze.freeze_delegate.frozen);
    assert_eq!(freeze.base.authority.address, None);
    assert_eq!(core.plugin_list.transfer_delegate.expect("transfer plugin").base.authority.address, None);
}

#[tokio::test]
async fn an_older_auction_cancelled_before_a_bid_is_thawed_in_place() {
    let (mut world, asset) = legacy_auctioned().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    let cancel = world.cancel_auction_ix(&asset, &seller.pubkey());
    let revoke_freeze = world.revoke_ix(&asset, &seller.pubkey(), PluginType::FreezeDelegate);
    let revoke_transfer = world.revoke_ix(&asset, &seller.pubkey(), PluginType::TransferDelegate);
    world.send(&[cancel, revoke_freeze, revoke_transfer], &[&seller]).await.expect("cancel and revoke");
    assert!(world.auction(&asset).await.is_none());
    assert_eq!(world.freeze_state(&asset).await, Some((None, false)));
    world.core_transfer(&asset, &seller, &stranger.pubkey()).await.expect("free to move again");
}

#[tokio::test]
async fn an_older_auction_whose_seller_revoked_the_delegate_pays_the_bid_back_at_once() {
    let (mut world, asset) = legacy_auctioned().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let buyer_before = world.balance(&buyer.pubkey()).await;
    world.bid(&asset, &buyer, START).await.expect("bid");

    // Core lets an owner revoke the TransferDelegate even while the asset is frozen.
    let revoke = world.revoke_ix(&asset, &seller.pubkey(), PluginType::TransferDelegate);
    world.send(&[revoke], &[&seller]).await.expect("Core allows this revoke");

    expect_market_error(world.bid(&asset, &stranger, 2 * START).await, MarketError::AuctionUndeliverable);
    // No waiting for the end: the bid is paid back now and the citizen thawed.
    world.settle(&asset, &stranger).await.expect("settle early");
    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before);
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
    assert_eq!(world.freeze_state(&asset).await.map(|(_, frozen)| frozen), Some(false));
    assert!(world.auction(&asset).await.is_none());
}
