//! Buying: who gets paid what, what moves, and that every refusal leaves
//! both the SOL and the citizen where they were.

use market::{constants::MIN_PRICE_LAMPORTS, core_asset, errors::MarketError};
use market_integration::*;
use mpl_core::AuthorityType;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, system_instruction};

/// Balances of everyone a sale can pay or charge.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
struct Balances {
    seller: u64,
    buyer: u64,
    treasury: u64,
    fee: u64,
}

async fn balances(world: &mut World) -> Balances {
    let (seller, buyer, treasury, fee) = (
        world.seller.pubkey(),
        world.buyer.pubkey(),
        world.treasury.pubkey(),
        world.fee_recipient.pubkey(),
    );
    Balances {
        seller: world.balance(&seller).await,
        buyer: world.balance(&buyer).await,
        treasury: world.balance(&treasury).await,
        fee: world.balance(&fee).await,
    }
}

/// A market with the seller's citizen listed at `price`.
async fn listed_at(price: u64) -> (World, Pubkey) {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.list(&asset, &seller, price).await.unwrap();
    (world, asset)
}

/// After a refused purchase nothing has moved.
async fn assert_untouched(world: &mut World, asset: &Pubkey, before: Balances) {
    assert_eq!(balances(world).await, before, "no SOL moved");
    let seller = world.seller.pubkey();
    assert_eq!(
        world.owner_of(asset).await,
        seller,
        "the citizen did not move"
    );
    assert!(
        world.listing(asset).await.is_some(),
        "the listing is still open"
    );
}

#[tokio::test]
async fn a_sale_pays_the_seller_and_the_royalty_and_moves_the_citizen() {
    let price = 650_000_000; // 0.65 SOL, the web preview's example
    let (mut world, asset) = listed_at(price).await;
    let buyer = world.buyer.insecure_clone();
    let before = balances(&mut world).await;

    world.buy(&asset, &buyer, price).await.unwrap();

    let after = balances(&mut world).await;
    assert_eq!(
        after.buyer,
        before.buyer - price,
        "the buyer pays the price, no more"
    );
    assert_eq!(after.treasury, before.treasury + 32_500_000, "5% royalty");
    assert_eq!(
        after.seller,
        before.seller + 617_500_000 + listing_rent(),
        "the rest of the price, plus the listing rent back"
    );
    assert_eq!(after.fee, before.fee, "no fee on devnet terms");

    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
    assert!(world.listing(&asset).await.is_none());

    // Core handed the delegate to the new owner, so the market can no longer move it.
    let core = world.core_asset(&asset).await;
    let delegate = core.plugin_list.transfer_delegate.expect("plugin kept");
    assert_eq!(delegate.base.authority.authority_type, AuthorityType::Owner);
    let account = world.account(&asset).await.unwrap();
    let read = core_asset::read_core_asset(&account.data).unwrap();
    assert_eq!(read.owner, buyer.pubkey());
    let authority = world.authority_key();
    assert!(!read.delegates_transfer_to(&authority));
}

#[tokio::test]
async fn a_market_fee_is_split_off_when_set() {
    let price = 10_000_019;
    let (mut world, asset) = listed_at(price).await;
    let admin = world.admin.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let (treasury, fee) = (world.treasury.pubkey(), world.fee_recipient.pubkey());
    let update = world.update_config_ix(&admin.pubkey(), (&treasury, &fee), ROYALTY_BPS, 250);
    world.send(&[update], &[&admin]).await.unwrap();
    let before = balances(&mut world).await;

    world.buy(&asset, &buyer, price).await.unwrap();

    // 5% and 2.5% of 10_000_019, each rounded down; the seller keeps the rest.
    let after = balances(&mut world).await;
    assert_eq!(after.treasury - before.treasury, 500_000);
    assert_eq!(after.fee - before.fee, 250_000);
    assert_eq!(after.seller - before.seller, 9_250_019 + listing_rent());
    assert_eq!(before.buyer - after.buyer, price);
}

#[tokio::test]
async fn a_raised_price_does_not_charge_the_buyer_more() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();

    let raise = world.update_price_ix(&asset, &seller.pubkey(), 2 * SOL);
    world.send(&[raise], &[&seller]).await.unwrap();
    let before = balances(&mut world).await;

    // The buyer signed for the price they saw.
    expect_market_error(
        world.buy(&asset, &buyer, SOL).await,
        MarketError::PriceAboveLimit,
    );
    assert_untouched(&mut world, &asset, before).await;

    // A lower price is fine: the buyer pays the listed price, not the limit.
    let lower = world.update_price_ix(&asset, &seller.pubkey(), SOL / 2);
    world.send(&[lower], &[&seller]).await.unwrap();
    let before = balances(&mut world).await;
    world.buy(&asset, &buyer, SOL).await.unwrap();
    assert_eq!(before.buyer - balances(&mut world).await.buyer, SOL / 2);
}

#[tokio::test]
async fn a_seller_cannot_buy_their_own_listing() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.insecure_clone();
    let before = balances(&mut world).await;
    expect_market_error(
        world.buy(&asset, &seller, SOL).await,
        MarketError::BuyerIsSeller,
    );
    assert_untouched(&mut world, &asset, before).await;
}

#[tokio::test]
async fn a_paused_market_sells_nothing() {
    let (mut world, asset) = listed_at(SOL).await;
    let admin = world.admin.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.unwrap();
    let before = balances(&mut world).await;

    expect_market_error(
        world.buy(&asset, &buyer, SOL).await,
        MarketError::MarketPaused,
    );
    assert_untouched(&mut world, &asset, before).await;

    let resume = world.set_paused_ix(&admin.pubkey(), false);
    world.send(&[resume], &[&admin]).await.unwrap();
    world.buy(&asset, &buyer, SOL).await.unwrap();
}

#[tokio::test]
async fn a_citizen_moved_away_cannot_be_bought() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let elsewhere = Keypair::new();
    world
        .core_transfer(&asset, &seller, &elsewhere.pubkey())
        .await
        .unwrap();
    let before = balances(&mut world).await;

    expect_market_error(
        world.buy(&asset, &buyer, SOL).await,
        MarketError::ListingStale,
    );
    assert_eq!(balances(&mut world).await, before);
    assert_eq!(world.owner_of(&asset).await, elsewhere.pubkey());
}

#[tokio::test]
async fn a_citizen_sent_away_and_back_needs_a_new_listing() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let friend = world.stranger.insecure_clone();
    world
        .core_transfer(&asset, &seller, &friend.pubkey())
        .await
        .unwrap();
    world
        .core_transfer(&asset, &friend, &seller.pubkey())
        .await
        .unwrap();

    // Same owner as the listing, but Core reset the delegate on the way.
    let before = balances(&mut world).await;
    expect_market_error(
        world.buy(&asset, &buyer, SOL).await,
        MarketError::ListingStale,
    );
    assert_untouched(&mut world, &asset, before).await;
}

#[tokio::test]
async fn a_revoked_delegate_stops_the_sale() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let revoke = world.revoke_delegate_ix(&asset, &seller.pubkey());
    world.send(&[revoke], &[&seller]).await.unwrap();
    let before = balances(&mut world).await;

    expect_market_error(
        world.buy(&asset, &buyer, SOL).await,
        MarketError::ListingStale,
    );
    assert_untouched(&mut world, &asset, before).await;
}

#[tokio::test]
async fn core_refusing_the_transfer_undoes_the_payments() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    // A frozen asset passes the market's checks; only Core says no.
    world.core_freeze(&asset, &seller).await.unwrap();
    let before = balances(&mut world).await;

    let result = world.buy(&asset, &buyer, SOL).await;
    let (index, _) = instruction_error(result);
    assert_eq!(index, 0);
    assert_untouched(&mut world, &asset, before).await;
}

#[tokio::test]
async fn substituted_accounts_are_refused() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.pubkey();
    let buyer = world.buyer.insecure_clone();
    let stranger = world.stranger.pubkey();
    let before = balances(&mut world).await;
    let buyer_key = buyer.pubkey();
    let base = |world: &World| world.buy_accounts(&asset, &seller, &buyer_key);

    let mut accounts = base(&world);
    accounts.collection = world.other_collection;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_market_error(
        world.send(&[ix], &[&buyer]).await,
        MarketError::WrongCollection,
    );

    let mut accounts = base(&world);
    accounts.royalty_recipient = stranger;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_market_error(
        world.send(&[ix], &[&buyer]).await,
        MarketError::InvalidConfig,
    );

    let mut accounts = base(&world);
    accounts.fee_recipient = stranger;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_market_error(
        world.send(&[ix], &[&buyer]).await,
        MarketError::InvalidConfig,
    );

    let mut accounts = base(&world);
    accounts.seller = stranger;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_market_error(
        world.send(&[ix], &[&buyer]).await,
        MarketError::Unauthorized,
    );

    let mut accounts = base(&world);
    accounts.market_authority = stranger;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_anchor_error(
        world.send(&[ix], &[&buyer]).await,
        anchor_lang::error::ErrorCode::ConstraintSeeds,
    );

    let mut accounts = base(&world);
    accounts.core_program = stranger;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_market_error(
        world.send(&[ix], &[&buyer]).await,
        MarketError::InvalidAsset,
    );

    // Another citizen of the seller under this citizen's listing.
    let other = world.mint(&seller).await;
    let mut accounts = base(&world);
    accounts.asset = other;
    let ix = world.buy_ix_with(accounts, SOL);
    expect_anchor_error(
        world.send(&[ix], &[&buyer]).await,
        anchor_lang::error::ErrorCode::ConstraintSeeds,
    );

    assert_untouched(&mut world, &asset, before).await;
}

#[tokio::test]
async fn a_listing_sells_once() {
    let (mut world, asset) = listed_at(SOL).await;
    let seller = world.seller.pubkey();
    let buyer = world.buyer.insecure_clone();
    let late = world.stranger.insecure_clone();
    world.buy(&asset, &buyer, SOL).await.unwrap();

    let again = world.buy_ix(&asset, &seller, &late.pubkey(), SOL);
    expect_anchor_error(
        world.send(&[again], &[&late]).await,
        anchor_lang::error::ErrorCode::AccountNotInitialized,
    );
    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
}

#[tokio::test]
async fn a_buyer_without_enough_sol_gets_nothing() {
    let (mut world, asset) = listed_at(SOL).await;
    let poor = Keypair::new();
    let funder = world.stranger.insecure_clone();
    let fund = system_instruction::transfer(&funder.pubkey(), &poor.pubkey(), SOL / 2);
    world.send(&[fund], &[&funder]).await.unwrap();
    let before = balances(&mut world).await;

    let result = world.buy(&asset, &poor, SOL).await;
    let (index, _) = instruction_error(result);
    assert_eq!(index, 0);
    assert_untouched(&mut world, &asset, before).await;
    assert_eq!(world.balance(&poor.pubkey()).await, SOL / 2);
}

#[tokio::test]
async fn the_buyer_can_sell_on_and_the_royalty_is_paid_again() {
    let (mut world, asset) = listed_at(SOL).await;
    let buyer = world.buyer.insecure_clone();
    let next = world.stranger.insecure_clone();
    world.buy(&asset, &buyer, SOL).await.unwrap();

    // The plugin is already there, held by the new owner; listing re-points it.
    world.list(&asset, &buyer, 2 * SOL).await.unwrap();
    let treasury = world.treasury.pubkey();
    let royalty_before = world.balance(&treasury).await;
    let buyer_before = world.balance(&buyer.pubkey()).await;

    world.buy(&asset, &next, 2 * SOL).await.unwrap();
    assert_eq!(world.owner_of(&asset).await, next.pubkey());
    assert_eq!(world.balance(&treasury).await - royalty_before, SOL / 10);
    assert_eq!(
        world.balance(&buyer.pubkey()).await - buyer_before,
        2 * SOL - SOL / 10 + listing_rent()
    );
}

#[tokio::test]
async fn the_royalty_recipient_can_sell_its_own_citizen() {
    let (mut world, _) = market_with_citizen().await;
    let treasury = world.treasury.insecure_clone();
    let buyer = world.buyer.insecure_clone();
    let asset = world.mint(&treasury.pubkey()).await;
    world.list(&asset, &treasury, SOL).await.unwrap();
    let before = world.balance(&treasury.pubkey()).await;

    // Seller and royalty recipient are the same account in one instruction.
    world.buy(&asset, &buyer, SOL).await.unwrap();
    assert_eq!(
        world.balance(&treasury.pubkey()).await - before,
        SOL + listing_rent()
    );
    assert_eq!(world.owner_of(&asset).await, buyer.pubkey());
}

#[tokio::test]
async fn the_cheapest_sale_still_pays_an_existing_recipient() {
    let (mut world, asset) = listed_at(MIN_PRICE_LAMPORTS).await;
    let buyer = world.buyer.insecure_clone();
    let treasury = world.treasury.pubkey();
    let before = world.balance(&treasury).await;
    world.buy(&asset, &buyer, MIN_PRICE_LAMPORTS).await.unwrap();
    // 5% of 0.01 SOL is below an empty account's rent minimum, which is why
    // the config insists the recipient already holds SOL.
    assert_eq!(world.balance(&treasury).await - before, 500_000);
}
