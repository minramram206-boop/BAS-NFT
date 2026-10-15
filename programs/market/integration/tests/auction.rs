//! Auctions against the Core program: the citizen stays in the seller's wallet,
//! frozen by the market, bids are held by the auction and paid back when
//! outbid, and settling moves the citizen and the money in one instruction.

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

#[tokio::test]
async fn an_auction_freezes_the_citizen_in_the_sellers_wallet() {
    let (mut world, asset) = auctioned().await;
    let authority = world.authority_key();
    let seller = world.seller.insecure_clone();

    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
    assert_eq!(world.freeze_state(&asset).await, Some((Some(authority), true)));
    let auction = world.auction(&asset).await.expect("auction");
    assert_eq!(auction.seller, seller.pubkey());
    assert_eq!(auction.start_price_lamports, START);
    assert_eq!(auction.bid_count, 0);
    assert_eq!(auction.ends_at - auction.started_at, 24 * AUCTION_HOUR_SECONDS);

    // Frozen: the seller can neither move nor burn it, nor take the freeze back.
    let stranger = world.stranger.pubkey();
    assert!(world.core_transfer(&asset, &seller, &stranger).await.is_err());
    assert!(world.core_burn(&asset, &seller).await.is_err());
    let revoke_freeze = world.revoke_ix(&asset, &seller.pubkey(), PluginType::FreezeDelegate);
    assert!(world.send(&[revoke_freeze], &[&seller]).await.is_err());

    // And it cannot also be listed for a fixed price.
    let listing = world.create_listing_ix(&asset, &seller.pubkey(), SOL);
    expect_market_error(world.send(&[listing], &[&seller]).await, MarketError::AssetFrozen);
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
    // Thawed, and Core handed both delegates back to the new owner.
    let core = world.core_asset(&asset).await;
    let freeze = core.plugin_list.freeze_delegate.expect("freeze plugin");
    assert!(!freeze.freeze_delegate.frozen);
    assert_eq!(freeze.base.authority.address, None);
    assert_eq!(core.plugin_list.transfer_delegate.expect("transfer plugin").base.authority.address, None);
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
    assert_eq!(world.balance(&seller.pubkey()).await - seller_before, auction_rent());
    assert_eq!(world.freeze_state(&asset).await.map(|(_, frozen)| frozen), Some(false), "thawed");

    // The client takes both delegates back in the same transaction; done
    // separately here so the auction rent above is measured alone. Core
    // shrinks the asset for each and returns that rent too.
    let revoke_freeze = world.revoke_ix(&asset, &seller.pubkey(), PluginType::FreezeDelegate);
    let revoke_transfer = world.revoke_ix(&asset, &seller.pubkey(), PluginType::TransferDelegate);
    world.send(&[revoke_freeze, revoke_transfer], &[&seller]).await.expect("revoke");
    assert_eq!(world.freeze_state(&asset).await, Some((None, false)));
    world.core_transfer(&asset, &seller, &stranger.pubkey()).await.expect("free to move again");
}

#[tokio::test]
async fn no_cancel_once_someone_has_bid() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    world.bid(&asset, &buyer, START).await.expect("bid");
    let cancel = world.cancel_auction_ix(&asset, &seller.pubkey());
    expect_market_error(world.send(&[cancel], &[&seller]).await, MarketError::AuctionHasBids);
}

#[tokio::test]
async fn an_auction_without_bids_ends_with_the_citizen_thawed_at_home() {
    let (mut world, asset) = auctioned().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let ends_at = world.auction(&asset).await.expect("auction").ends_at;
    let seller_before = world.balance(&seller.pubkey()).await;

    world.set_time(ends_at).await;
    world.settle(&asset, &stranger).await.expect("settle without bids");
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
    assert_eq!(world.freeze_state(&asset).await.map(|(_, frozen)| frozen), Some(false));
    assert_eq!(world.balance(&seller.pubkey()).await - seller_before, auction_rent());
    assert!(world.auction(&asset).await.is_none());
}

#[tokio::test]
async fn a_seller_who_revokes_the_transfer_delegate_stops_the_auction_and_the_bid_comes_back_at_once() {
    let (mut world, asset) = auctioned().await;
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
async fn a_paused_market_takes_no_bids_but_still_settles() {
    let (mut world, asset) = auctioned().await;
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let admin = world.admin.insecure_clone();
    world.bid(&asset, &buyer, START).await.expect("bid");

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.expect("pause");
    expect_market_error(world.bid(&asset, &stranger, 2 * START).await, MarketError::MarketPaused);

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

    // Both plugins are back with the owner, so the client re-points them.
    world.start_auction(&asset, &buyer, START, 24).await.expect("auction it again");
    let authority = world.authority_key();
    assert_eq!(world.freeze_state(&asset).await, Some((Some(authority), true)));
    let cancel = world.cancel_auction_ix(&asset, &buyer.pubkey());
    world.send(&[cancel], &[&buyer]).await.expect("cancel");

    world.list(&asset, &buyer, SOL).await.expect("then list it, thawed");
    world.buy(&asset, &stranger, SOL).await.expect("and sell it");
    assert_eq!(world.owner_of(&asset).await, stranger.pubkey());
}
