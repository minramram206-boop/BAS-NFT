//! Listing a citizen, changing its price, cancelling, and clearing listings
//! that no longer match the asset.

use market::{
    constants::{LISTING_VERSION, MAX_PRICE_LAMPORTS, MIN_PRICE_LAMPORTS},
    errors::MarketError,
};
use market_integration::*;
use mpl_core::AuthorityType;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, system_instruction};

/// The TransferDelegate plugin's authority as Core's own client decodes it.
async fn delegate_authority(
    world: &mut World,
    asset: &Pubkey,
) -> Option<(AuthorityType, Option<Pubkey>)> {
    world
        .core_asset(asset)
        .await
        .plugin_list
        .transfer_delegate
        .map(|plugin| {
            (
                plugin.base.authority.authority_type,
                plugin.base.authority.address,
            )
        })
}

#[tokio::test]
async fn listing_keeps_the_citizen_in_the_wallet() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let before = world.balance(&seller.pubkey()).await;

    world.list(&asset, &seller, SOL).await.unwrap();

    let listing = world.listing(&asset).await.expect("listing created");
    assert_eq!(listing.version, LISTING_VERSION);
    assert_eq!(listing.asset, asset);
    assert_eq!(listing.seller, seller.pubkey());
    assert_eq!(listing.price_lamports, SOL);
    assert_eq!(listing.bump, market::pda::listing_address(&asset).1);

    assert_eq!(world.owner_of(&asset).await, seller.pubkey(), "no custody");
    let authority = world.authority_key();
    assert_eq!(
        delegate_authority(&mut world, &asset).await,
        Some((AuthorityType::Address, Some(authority)))
    );
    // The seller paid the listing rent and the plugin's extra bytes, nothing else.
    let spent = before - world.balance(&seller.pubkey()).await;
    assert!(
        spent >= listing_rent() && spent < listing_rent() + 2_000_000,
        "spent {spent}"
    );
}

#[tokio::test]
async fn listing_needs_the_market_as_delegate() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();

    let alone = world.create_listing_ix(&asset, &seller.pubkey(), SOL);
    expect_market_error(
        world.send(&[alone], &[&seller]).await,
        MarketError::DelegateMissing,
    );

    let someone_else = world.stranger.pubkey();
    let mut instructions = world
        .delegate_ix(&asset, &seller.pubkey(), &someone_else)
        .await;
    instructions.push(world.create_listing_ix(&asset, &seller.pubkey(), SOL));
    expect_market_error(
        world.send(&instructions, &[&seller]).await,
        MarketError::DelegateMissing,
    );
    assert!(world.listing(&asset).await.is_none());
}

#[tokio::test]
async fn only_the_owner_lists() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    // The owner names the market as delegate but never lists.
    let authority = world.authority_key();
    let delegate = world
        .delegate_ix(&asset, &seller.pubkey(), &authority)
        .await;
    world.send(&delegate, &[&seller]).await.unwrap();

    let listing = world.create_listing_ix(&asset, &stranger.pubkey(), SOL);
    expect_market_error(
        world.send(&[listing], &[&stranger]).await,
        MarketError::NotOwner,
    );
}

#[tokio::test]
async fn other_collections_are_refused() {
    let (mut world, _) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let other = world.other_collection;
    let foreign = world.mint_into(other, &seller.pubkey(), 77).await;

    expect_market_error(
        world.list(&foreign, &seller, SOL).await,
        MarketError::WrongCollection,
    );
}

#[tokio::test]
async fn non_assets_are_refused() {
    let (mut world, _) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();

    // Owned by Core but a collection, not an asset.
    let collection = world.collection;
    let listing = world.create_listing_ix(&collection, &seller.pubkey(), SOL);
    expect_market_error(
        world.send(&[listing], &[&seller]).await,
        MarketError::InvalidAsset,
    );

    // A wallet.
    let wallet = world.stranger.pubkey();
    let listing = world.create_listing_ix(&wallet, &seller.pubkey(), SOL);
    expect_market_error(
        world.send(&[listing], &[&seller]).await,
        MarketError::InvalidAsset,
    );
}

#[tokio::test]
async fn price_must_be_within_the_limits() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();

    for price in [0, MIN_PRICE_LAMPORTS - 1, MAX_PRICE_LAMPORTS + 1, u64::MAX] {
        expect_market_error(
            world.list(&asset, &seller, price).await,
            MarketError::PriceOutOfRange,
        );
    }

    world
        .list(&asset, &seller, MIN_PRICE_LAMPORTS)
        .await
        .unwrap();
    let second = world.mint(&seller.pubkey()).await;
    world
        .list(&second, &seller, MAX_PRICE_LAMPORTS)
        .await
        .unwrap();
}

#[tokio::test]
async fn paused_market_takes_no_listings() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let admin = world.admin.insecure_clone();
    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.unwrap();

    expect_market_error(
        world.list(&asset, &seller, SOL).await,
        MarketError::MarketPaused,
    );
}

#[tokio::test]
async fn one_listing_per_citizen() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();

    let again = world.create_listing_ix(&asset, &seller.pubkey(), 2 * SOL);
    expect_already_in_use(world.send(&[again], &[&seller]).await);
    assert_eq!(world.listing(&asset).await.unwrap().price_lamports, SOL);
}

#[tokio::test]
async fn sending_lamports_to_the_listing_address_does_not_block_it() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let listing_key = world.listing_key(&asset);

    // The smallest amount the runtime lets anyone leave in an empty account.
    let rent_minimum = solana_sdk::rent::Rent::default().minimum_balance(0);
    let grief = system_instruction::transfer(&stranger.pubkey(), &listing_key, rent_minimum);
    world.send(&[grief], &[&stranger]).await.unwrap();

    world.list(&asset, &seller, SOL).await.unwrap();
    assert_eq!(world.listing(&asset).await.unwrap().price_lamports, SOL);
}

#[tokio::test]
async fn seller_changes_the_price() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();
    let listed_at = world.listing(&asset).await.unwrap().listed_at;

    let update = world.update_price_ix(&asset, &seller.pubkey(), 3 * SOL / 2);
    world.send(&[update], &[&seller]).await.unwrap();
    let listing = world.listing(&asset).await.unwrap();
    assert_eq!(listing.price_lamports, 3 * SOL / 2);
    assert_eq!(
        listing.listed_at, listed_at,
        "a price change keeps the listing date"
    );

    let same = world.update_price_ix(&asset, &seller.pubkey(), 3 * SOL / 2);
    expect_market_error(
        world.send(&[same], &[&seller]).await,
        MarketError::PriceUnchanged,
    );

    let low = world.update_price_ix(&asset, &seller.pubkey(), MIN_PRICE_LAMPORTS - 1);
    expect_market_error(
        world.send(&[low], &[&seller]).await,
        MarketError::PriceOutOfRange,
    );
}

#[tokio::test]
async fn only_the_seller_changes_the_price() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();

    let update = world.update_price_ix(&asset, &stranger.pubkey(), 1);
    expect_market_error(
        world.send(&[update], &[&stranger]).await,
        MarketError::Unauthorized,
    );
    assert_eq!(world.listing(&asset).await.unwrap().price_lamports, SOL);
}

#[tokio::test]
async fn price_changes_stop_when_paused_or_stale() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let admin = world.admin.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.unwrap();
    let update = world.update_price_ix(&asset, &seller.pubkey(), 2 * SOL);
    expect_market_error(
        world.send(&[update], &[&seller]).await,
        MarketError::MarketPaused,
    );
    let resume = world.set_paused_ix(&admin.pubkey(), false);
    world.send(&[resume], &[&admin]).await.unwrap();

    // The seller removes the delegate outside the market.
    let revoke = world.revoke_delegate_ix(&asset, &seller.pubkey());
    world.send(&[revoke], &[&seller]).await.unwrap();
    let update = world.update_price_ix(&asset, &seller.pubkey(), 2 * SOL);
    expect_market_error(
        world.send(&[update], &[&seller]).await,
        MarketError::ListingStale,
    );
}

#[tokio::test]
async fn cancel_returns_the_rent_and_the_delegate() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();
    let before = world.balance(&seller.pubkey()).await;

    let revoke = world.revoke_delegate_ix(&asset, &seller.pubkey());
    let cancel = world.cancel_ix(&asset, &seller.pubkey());
    world.send(&[revoke, cancel], &[&seller]).await.unwrap();

    assert!(world.listing(&asset).await.is_none());
    // Core also refunds the rent of the 32-byte delegate address it no longer stores.
    let address_rent = solana_sdk::rent::Rent::default().minimum_balance(32)
        - solana_sdk::rent::Rent::default().minimum_balance(0);
    assert_eq!(
        world.balance(&seller.pubkey()).await,
        before + listing_rent() + address_rent
    );
    assert_eq!(
        delegate_authority(&mut world, &asset).await,
        Some((AuthorityType::Owner, None)),
        "the plugin stays, held by the owner again"
    );

    // Listing again goes through ApprovePluginAuthority, since the plugin exists.
    world.list(&asset, &seller, 2 * SOL).await.unwrap();
    assert_eq!(world.listing(&asset).await.unwrap().price_lamports, 2 * SOL);
}

#[tokio::test]
async fn only_the_seller_cancels_and_a_pause_does_not_stop_it() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let admin = world.admin.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();

    let cancel = world.cancel_ix(&asset, &stranger.pubkey());
    expect_market_error(
        world.send(&[cancel], &[&stranger]).await,
        MarketError::Unauthorized,
    );

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.unwrap();
    let cancel = world.cancel_ix(&asset, &seller.pubkey());
    world.send(&[cancel], &[&seller]).await.unwrap();
    assert!(world.listing(&asset).await.is_none());
}

#[tokio::test]
async fn a_valid_listing_is_not_stale() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();

    let close = world.close_stale_ix(&asset, &seller.pubkey(), &stranger.pubkey());
    expect_market_error(
        world.send(&[close], &[&stranger]).await,
        MarketError::ListingNotStale,
    );
    assert!(world.listing(&asset).await.is_some());
}

#[tokio::test]
async fn moving_the_citizen_away_makes_the_listing_stale() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let receiver = Keypair::new();
    world.list(&asset, &seller, SOL).await.unwrap();

    world
        .core_transfer(&asset, &seller, &receiver.pubkey())
        .await
        .unwrap();
    // Core gives the delegate back to the new owner on every transfer.
    assert_eq!(
        delegate_authority(&mut world, &asset).await,
        Some((AuthorityType::Owner, None))
    );

    // The rent goes to the seller, whoever sends the close.
    let wrong_seller = world.close_stale_ix(&asset, &stranger.pubkey(), &stranger.pubkey());
    expect_market_error(
        world.send(&[wrong_seller], &[&stranger]).await,
        MarketError::Unauthorized,
    );
    let before = world.balance(&seller.pubkey()).await;
    let close = world.close_stale_ix(&asset, &seller.pubkey(), &stranger.pubkey());
    world.send(&[close], &[&stranger]).await.unwrap();
    assert!(world.listing(&asset).await.is_none());
    assert_eq!(
        world.balance(&seller.pubkey()).await,
        before + listing_rent()
    );
}

#[tokio::test]
async fn new_owner_clears_the_old_listing_and_lists_again() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let receiver = world.buyer.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();
    world
        .core_transfer(&asset, &seller, &receiver.pubkey())
        .await
        .unwrap();

    // While the old listing exists, a new one cannot be created.
    expect_already_in_use(world.list(&asset, &receiver, 2 * SOL).await);

    // The client puts the close in front of the new listing.
    let authority = world.authority_key();
    let mut instructions = vec![world.close_stale_ix(&asset, &seller.pubkey(), &receiver.pubkey())];
    instructions.extend(
        world
            .delegate_ix(&asset, &receiver.pubkey(), &authority)
            .await,
    );
    instructions.push(world.create_listing_ix(&asset, &receiver.pubkey(), 2 * SOL));
    world.send(&instructions, &[&receiver]).await.unwrap();
    let listing = world.listing(&asset).await.unwrap();
    assert_eq!(listing.seller, receiver.pubkey());
    assert_eq!(listing.price_lamports, 2 * SOL);
}

#[tokio::test]
async fn a_revoked_delegate_or_a_burn_makes_the_listing_stale() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();

    let revoke = world.revoke_delegate_ix(&asset, &seller.pubkey());
    world.send(&[revoke], &[&seller]).await.unwrap();
    let close = world.close_stale_ix(&asset, &seller.pubkey(), &stranger.pubkey());
    world.send(&[close], &[&stranger]).await.unwrap();
    assert!(world.listing(&asset).await.is_none());

    world.list(&asset, &seller, SOL).await.unwrap();
    world.core_burn(&asset, &seller).await.unwrap();
    let close = world.close_stale_ix(&asset, &seller.pubkey(), &stranger.pubkey());
    world.send(&[close], &[&stranger]).await.unwrap();
    assert!(world.listing(&asset).await.is_none());
}

#[tokio::test]
async fn a_delegate_held_elsewhere_is_revoked_before_the_market_takes_it() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let elsewhere = world.stranger.pubkey();
    let authority = world.authority_key();

    // Another marketplace holds the TransferDelegate.
    let other = world.delegate_ix(&asset, &seller.pubkey(), &elsewhere).await;
    world.send(&other, &[&seller]).await.unwrap();

    // Approving over it is refused by Core; revoking first is what works.
    let direct = world.approve_transfer_ix(&asset, &seller.pubkey(), &authority);
    assert!(world.send(&[direct], &[&seller]).await.is_err(), "Core refuses to re-point a delegated plugin");
    let take_back = world.delegate_ix(&asset, &seller.pubkey(), &authority).await;
    assert_eq!(take_back.len(), 2, "revoke, then approve");
    world.list(&asset, &seller, SOL).await.unwrap();
    assert_eq!(world.listing(&asset).await.unwrap().seller, seller.pubkey());
}
