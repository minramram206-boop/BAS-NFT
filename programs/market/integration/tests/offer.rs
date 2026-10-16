//! Offers against the Core program: the buyer's SOL is held by the offer
//! until the owner accepts it or the buyer takes it back, and accepting moves
//! the citizen and the money in one instruction.

use market::constants::AUCTION_HOUR_SECONDS;
use market::errors::MarketError;
use anchor_lang::error::ErrorCode;
use market_integration::{
    expect_anchor_error, expect_market_error, listing_rent, market_with_citizen, offer_rent, World, SOL,
};
use solana_sdk::{pubkey::Pubkey, signer::Signer};

const OFFER: u64 = 3 * SOL / 10;
const DAY: i64 = 24 * AUCTION_HOUR_SECONDS;

async fn offered() -> (World, Pubkey) {
    let (mut world, asset) = market_with_citizen().await;
    let buyer = world.buyer.insecure_clone();
    world.make_offer(&asset, &buyer, OFFER, 3).await.expect("make an offer");
    (world, asset)
}

#[tokio::test]
async fn the_offer_holds_the_sol_and_the_owner_accepts_it() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let offer_key = world.offer_key(&asset, &buyer.pubkey());

    let buyer_before = world.balance(&buyer.pubkey()).await;
    world.make_offer(&asset, &buyer, OFFER, 3).await.expect("make an offer");
    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before - OFFER - offer_rent());
    assert_eq!(world.balance(&offer_key).await, offer_rent() + OFFER);
    let offer = world.offer(&asset, &buyer.pubkey()).await.expect("offer");
    assert_eq!((offer.asset, offer.buyer, offer.amount_lamports), (asset, buyer.pubkey(), OFFER));
    assert_eq!(offer.expires_at - offer.made_at, 3 * DAY);
    assert_eq!(world.owner_of(&asset).await, seller.pubkey(), "the citizen stays with its owner");

    let seller_before = world.balance(&seller.pubkey()).await;
    let treasury_before = world.balance(&world.treasury.pubkey()).await;
    world.accept_offer(&asset, &seller, &buyer.pubkey(), OFFER).await.expect("accept");

    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
    let royalty = OFFER / 20;
    assert_eq!(world.balance(&world.treasury.pubkey()).await - treasury_before, royalty);
    assert_eq!(world.balance(&seller.pubkey()).await - seller_before, OFFER - royalty);
    assert_eq!(
        world.balance(&buyer.pubkey()).await,
        buyer_before - OFFER,
        "the buyer paid the offer and got the rent back"
    );
    assert!(world.account(&offer_key).await.is_none(), "the offer is closed");
    let stranger = world.stranger.pubkey();
    world.core_transfer(&asset, &buyer, &stranger).await.expect("the buyer owns it outright");
}

#[tokio::test]
async fn a_new_offer_replaces_the_old_one_and_returns_its_sol() {
    let (mut world, asset) = market_with_citizen().await;
    let buyer = world.buyer.insecure_clone();
    let offer_key = world.offer_key(&asset, &buyer.pubkey());
    let buyer_before = world.balance(&buyer.pubkey()).await;

    world.make_offer(&asset, &buyer, OFFER, 3).await.expect("first offer");
    let first = world.offer(&asset, &buyer.pubkey()).await.expect("offer");
    world.set_time(first.made_at + DAY).await;
    let lower = OFFER / 2;
    world.make_offer(&asset, &buyer, lower, 7).await.expect("lower offer");

    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before - lower - offer_rent());
    assert_eq!(world.balance(&offer_key).await, offer_rent() + lower, "the offer holds only the new amount");
    let offer = world.offer(&asset, &buyer.pubkey()).await.expect("offer");
    assert_eq!(offer.amount_lamports, lower);
    assert_eq!(offer.made_at, first.made_at + DAY);
    assert_eq!(offer.expires_at, offer.made_at + 7 * DAY);

    world.make_offer(&asset, &buyer, 2 * OFFER, 1).await.expect("higher offer");
    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before - 2 * OFFER - offer_rent());
}

#[tokio::test]
async fn the_buyer_takes_the_offer_back_at_any_time_even_while_paused() {
    let (mut world, asset) = market_with_citizen().await;
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let admin = world.admin.insecure_clone();
    let buyer_before = world.balance(&buyer.pubkey()).await;
    world.make_offer(&asset, &buyer, OFFER, 1).await.expect("offer");

    // The stranger has no offer here, so there is nothing to take back.
    expect_anchor_error(world.withdraw_offer(&asset, &stranger).await, ErrorCode::AccountNotInitialized);
    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.expect("pause");

    world.withdraw_offer(&asset, &buyer).await.expect("withdraw while paused");
    assert_eq!(world.balance(&buyer.pubkey()).await, buyer_before, "everything came back");
    assert!(world.offer(&asset, &buyer.pubkey()).await.is_none());
    expect_anchor_error(world.withdraw_offer(&asset, &buyer).await, ErrorCode::AccountNotInitialized);
}

#[tokio::test]
async fn an_expired_offer_cannot_be_accepted_and_anyone_may_close_it() {
    let (mut world, asset) = offered().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.pubkey();
    let stranger = world.stranger.insecure_clone();
    let offer = world.offer(&asset, &buyer).await.expect("offer");
    let buyer_before = world.balance(&buyer).await;

    world.set_time(offer.expires_at - 1).await;
    expect_market_error(world.close_expired_offer(&asset, &buyer, &stranger).await, MarketError::OfferNotExpired);

    world.set_time(offer.expires_at).await;
    expect_market_error(world.accept_offer(&asset, &seller, &buyer, OFFER).await, MarketError::OfferExpired);
    world.set_time(offer.expires_at).await;
    world.close_expired_offer(&asset, &buyer, &stranger).await.expect("anyone closes it after the end");
    assert_eq!(world.balance(&buyer).await, buyer_before + OFFER + offer_rent());
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());
}

#[tokio::test]
async fn offers_follow_the_market_rules() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let admin = world.admin.insecure_clone();
    let min = market::constants::MIN_PRICE_LAMPORTS;
    let max = market::constants::MAX_PRICE_LAMPORTS;

    expect_market_error(world.make_offer(&asset, &seller, OFFER, 3).await, MarketError::BuyerIsSeller);
    expect_market_error(world.make_offer(&asset, &buyer, min - 1, 3).await, MarketError::PriceOutOfRange);
    expect_market_error(world.make_offer(&asset, &buyer, max + 1, 3).await, MarketError::PriceOutOfRange);
    for days in [0, 2, 5, 30] {
        expect_market_error(world.make_offer(&asset, &buyer, OFFER, days).await, MarketError::InvalidOfferLength);
    }

    let other = world.other_collection;
    let foreign = world.mint_into(other, &seller.pubkey(), 2).await;
    expect_market_error(world.make_offer(&foreign, &buyer, OFFER, 3).await, MarketError::WrongCollection);

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.expect("pause");
    expect_market_error(world.make_offer(&asset, &buyer, OFFER, 3).await, MarketError::MarketPaused);
    let open = world.set_paused_ix(&admin.pubkey(), false);
    world.send(&[open], &[&admin]).await.expect("open");
    world.make_offer(&asset, &buyer, min, 1).await.expect("the lowest price for the shortest time");
    world.make_offer(&asset, &buyer, max.min(50 * SOL), 7).await.expect("a large offer for the longest time");
}

#[tokio::test]
async fn no_offer_on_a_citizen_at_auction_or_frozen() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    world.start_auction(&asset, &seller, SOL / 10, 24).await.expect("auction");
    expect_market_error(world.make_offer(&asset, &buyer, OFFER, 3).await, MarketError::AssetInAuction);

    let frozen = world.mint(&seller.pubkey()).await;
    world.core_freeze(&frozen, &seller).await.expect("freeze");
    expect_market_error(world.make_offer(&frozen, &buyer, OFFER, 3).await, MarketError::AssetFrozen);
}

#[tokio::test]
async fn an_offer_made_before_the_auction_cannot_be_accepted_during_it() {
    let (mut world, asset) = offered().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.pubkey();
    world.start_auction(&asset, &seller, SOL / 10, 24).await.expect("auction");
    expect_market_error(world.accept_offer(&asset, &seller, &buyer, OFFER).await, MarketError::NotOwner);
    assert!(world.offer(&asset, &buyer).await.is_some(), "the offer waits, and its buyer can still take it back");
}

#[tokio::test]
async fn only_the_owner_accepts_and_only_at_the_amount_shown() {
    let (mut world, asset) = offered().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    expect_market_error(
        world.accept_offer(&asset, &stranger, &buyer.pubkey(), OFFER).await,
        MarketError::NotOwner,
    );
    expect_market_error(
        world.accept_offer(&asset, &seller, &buyer.pubkey(), OFFER + 1).await,
        MarketError::OfferChanged,
    );
    // The buyer lowers the offer just before the owner accepts what they saw.
    world.make_offer(&asset, &buyer, OFFER / 3, 3).await.expect("lower it");
    expect_market_error(
        world.accept_offer(&asset, &seller, &buyer.pubkey(), OFFER).await,
        MarketError::OfferChanged,
    );
    assert_eq!(world.owner_of(&asset).await, seller.pubkey());

    let admin = world.admin.insecure_clone();
    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.expect("pause");
    expect_market_error(
        world.accept_offer(&asset, &seller, &buyer.pubkey(), OFFER / 3).await,
        MarketError::MarketPaused,
    );
}

#[tokio::test]
async fn accepting_closes_the_owners_listing_and_other_offers_stay_for_the_new_owner() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    world.list(&asset, &seller, SOL).await.expect("list");
    world.make_offer(&asset, &buyer, OFFER, 3).await.expect("buyer offers");
    world.make_offer(&asset, &stranger, OFFER / 2, 7).await.expect("stranger offers");

    let seller_before = world.balance(&seller.pubkey()).await;
    world.accept_offer(&asset, &seller, &buyer.pubkey(), OFFER).await.expect("accept");
    assert!(world.listing(&asset).await.is_none(), "the listing closed with the sale");
    assert_eq!(
        world.balance(&seller.pubkey()).await - seller_before,
        OFFER - OFFER / 20 + listing_rent(),
        "the proceeds and the listing's rent"
    );
    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());

    // The stranger's offer is still there, now for the buyer to accept.
    expect_market_error(
        world.accept_offer(&asset, &seller, &stranger.pubkey(), OFFER / 2).await,
        MarketError::NotOwner,
    );
    world.accept_offer(&asset, &buyer, &stranger.pubkey(), OFFER / 2).await.expect("the new owner accepts");
    assert_eq!(world.owner_of(&asset).await, stranger.pubkey());

    // And the citizen can be listed again by its latest owner.
    world.list(&asset, &stranger, SOL).await.expect("list again");
}

#[tokio::test]
async fn a_listing_left_out_of_the_acceptance_turns_stale() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.list(&asset, &seller, SOL).await.expect("list");
    world.make_offer(&asset, &buyer, OFFER, 3).await.expect("offer");

    let accept = world.accept_offer_ix(&asset, &seller.pubkey(), &buyer.pubkey(), OFFER, None);
    world.send(&[accept], &[&seller]).await.expect("accept without the listing");
    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
    expect_market_error(world.buy(&asset, &stranger, SOL).await, MarketError::ListingStale);
    let close = world.close_stale_ix(&asset, &seller.pubkey(), &stranger.pubkey());
    world.send(&[close], &[&stranger]).await.expect("anyone closes the stale listing");
}

#[tokio::test]
async fn the_listing_passed_must_be_the_owners() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    world.list(&asset, &seller, SOL).await.expect("list");
    // The seller hands the citizen to the stranger outside the market; the listing is now stale.
    world.core_transfer(&asset, &seller, &stranger.pubkey()).await.expect("transfer");
    world.make_offer(&asset, &buyer, OFFER, 3).await.expect("offer");

    let listing = Some(world.listing_key(&asset));
    let accept = world.accept_offer_ix(&asset, &stranger.pubkey(), &buyer.pubkey(), OFFER, listing);
    expect_market_error(world.send(&[accept], &[&stranger]).await, MarketError::Unauthorized);
    world.accept_offer(&asset, &stranger, &buyer.pubkey(), OFFER).await.expect("accept without someone else's listing");
}
