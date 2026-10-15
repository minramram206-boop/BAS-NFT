//! Market configuration: who may set it up, which terms it accepts, pausing
//! and the two-step admin handover.

use market::{constants::MARKET_CONFIG_VERSION, errors::MarketError, pda, InitializeConfigArgs};
use market_integration::*;
use solana_sdk::{signature::Keypair, signer::Signer};

fn devnet_terms() -> InitializeConfigArgs {
    InitializeConfigArgs {
        royalty_bps: ROYALTY_BPS,
        fee_bps: 0,
    }
}

#[tokio::test]
async fn initialize_starts_paused_with_the_given_terms() {
    let mut world = start().await;
    let admin = world.admin.insecure_clone();
    let init = world.initialize_ix(&admin.pubkey(), world.collection, devnet_terms());
    world.send(&[init], &[&admin]).await.unwrap();

    let config = world.config().await;
    assert_eq!(config.version, MARKET_CONFIG_VERSION);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.pending_admin, Default::default());
    assert_eq!(config.collection, world.collection);
    assert_eq!(config.royalty_bps, ROYALTY_BPS);
    assert_eq!(config.royalty_recipient, world.treasury.pubkey());
    assert_eq!(config.fee_bps, 0);
    assert_eq!(config.fee_recipient, world.fee_recipient.pubkey());
    assert!(config.is_paused);
    assert_eq!(config.bump, pda::config_address().1);
    assert_eq!(config.authority_bump, pda::authority_address().1);
}

#[tokio::test]
async fn only_the_upgrade_authority_can_initialize() {
    let mut world = start().await;
    let stranger = world.stranger.insecure_clone();
    let init = world.initialize_ix(&stranger.pubkey(), world.collection, devnet_terms());
    expect_market_error(
        world.send(&[init], &[&stranger]).await,
        MarketError::Unauthorized,
    );

    // An immutable program has no upgrade authority, so nobody can initialize.
    world.install_program_data(None).await;
    let admin = world.admin.insecure_clone();
    let init = world.initialize_ix(&admin.pubkey(), world.collection, devnet_terms());
    expect_market_error(
        world.send(&[init], &[&admin]).await,
        MarketError::Unauthorized,
    );
}

#[tokio::test]
async fn initialize_runs_once() {
    let mut world = start().await;
    world.open_market().await;
    let admin = world.admin.insecure_clone();
    let again = world.initialize_ix(&admin.pubkey(), world.collection, devnet_terms());
    expect_already_in_use(world.send(&[again], &[&admin]).await);
}

#[tokio::test]
async fn initialize_refuses_terms_out_of_range() {
    let mut world = start().await;
    let admin = world.admin.insecure_clone();
    for (royalty_bps, fee_bps) in [(2_501, 0), (500, 1_001), (u16::MAX, u16::MAX)] {
        let init = world.initialize_ix(
            &admin.pubkey(),
            world.collection,
            InitializeConfigArgs {
                royalty_bps,
                fee_bps,
            },
        );
        expect_market_error(
            world.send(&[init], &[&admin]).await,
            MarketError::InvalidConfig,
        );
    }
    // The limits themselves are accepted.
    let init = world.initialize_ix(
        &admin.pubkey(),
        world.collection,
        InitializeConfigArgs {
            royalty_bps: 2_500,
            fee_bps: 1_000,
        },
    );
    world.send(&[init], &[&admin]).await.unwrap();
}

#[tokio::test]
async fn initialize_needs_a_core_collection() {
    let mut world = start().await;
    let admin = world.admin.insecure_clone();
    let seller = world.seller.pubkey();
    let asset = world.mint(&seller).await;

    // A Core asset is owned by Core but is not a collection.
    let init = world.initialize_ix(&admin.pubkey(), asset, devnet_terms());
    expect_market_error(
        world.send(&[init], &[&admin]).await,
        MarketError::InvalidConfig,
    );

    // A wallet is not owned by Core at all.
    let init = world.initialize_ix(&admin.pubkey(), seller, devnet_terms());
    expect_market_error(
        world.send(&[init], &[&admin]).await,
        MarketError::InvalidConfig,
    );
}

#[tokio::test]
async fn initialize_needs_funded_recipients() {
    let mut world = start().await;
    let admin = world.admin.insecure_clone();
    let empty = Keypair::new().pubkey();
    let funded = world.treasury.pubkey();

    for recipients in [(&empty, &funded), (&funded, &empty)] {
        let init = world.initialize_ix_paying(
            &admin.pubkey(),
            world.collection,
            recipients,
            devnet_terms(),
        );
        expect_market_error(
            world.send(&[init], &[&admin]).await,
            MarketError::RecipientNotFunded,
        );
    }
}

#[tokio::test]
async fn admin_updates_the_payout_terms() {
    let mut world = start().await;
    world.open_market().await;
    let admin = world.admin.insecure_clone();
    let new_royalty = world.stranger.pubkey();
    let fee = world.fee_recipient.pubkey();

    let update = world.update_config_ix(&admin.pubkey(), (&new_royalty, &fee), 400, 100);
    world.send(&[update], &[&admin]).await.unwrap();

    let config = world.config().await;
    assert_eq!(config.royalty_bps, 400);
    assert_eq!(config.royalty_recipient, new_royalty);
    assert_eq!(config.fee_bps, 100);
    assert_eq!(config.fee_recipient, fee);
    assert_eq!(
        config.collection, world.collection,
        "the collection never changes"
    );
    assert!(
        !config.is_paused,
        "updating terms does not touch the pause flag"
    );
}

#[tokio::test]
async fn update_config_is_checked_like_initialize() {
    let mut world = start().await;
    world.open_market().await;
    let admin = world.admin.insecure_clone();
    let stranger = world.stranger.insecure_clone();
    let treasury = world.treasury.pubkey();
    let fee = world.fee_recipient.pubkey();
    let empty = Keypair::new().pubkey();

    let update = world.update_config_ix(&stranger.pubkey(), (&treasury, &fee), 500, 0);
    expect_market_error(
        world.send(&[update], &[&stranger]).await,
        MarketError::Unauthorized,
    );

    let update = world.update_config_ix(&admin.pubkey(), (&treasury, &fee), 2_501, 0);
    expect_market_error(
        world.send(&[update], &[&admin]).await,
        MarketError::InvalidConfig,
    );

    let update = world.update_config_ix(&admin.pubkey(), (&treasury, &empty), 500, 0);
    expect_market_error(
        world.send(&[update], &[&admin]).await,
        MarketError::RecipientNotFunded,
    );
}

#[tokio::test]
async fn only_the_admin_pauses() {
    let mut world = start().await;
    world.open_market().await;
    let admin = world.admin.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    let pause = world.set_paused_ix(&stranger.pubkey(), true);
    expect_market_error(
        world.send(&[pause], &[&stranger]).await,
        MarketError::Unauthorized,
    );
    assert!(!world.config().await.is_paused);

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.unwrap();
    assert!(world.config().await.is_paused);

    // Setting the same state twice is accepted and changes nothing.
    let pause = world.set_paused_ix(&admin.pubkey(), true);
    world.send(&[pause], &[&admin]).await.unwrap();
    assert!(world.config().await.is_paused);

    let resume = world.set_paused_ix(&admin.pubkey(), false);
    world.send(&[resume], &[&admin]).await.unwrap();
    assert!(!world.config().await.is_paused);
}

#[tokio::test]
async fn admin_handover_takes_two_steps() {
    let mut world = start().await;
    world.open_market().await;
    let admin = world.admin.insecure_clone();
    let successor = world.stranger.insecure_clone();
    let outsider = world.buyer.insecure_clone();

    let propose = world.propose_admin_ix(&outsider.pubkey(), outsider.pubkey());
    expect_market_error(
        world.send(&[propose], &[&outsider]).await,
        MarketError::Unauthorized,
    );

    for refused in [admin.pubkey(), Default::default()] {
        let propose = world.propose_admin_ix(&admin.pubkey(), refused);
        expect_market_error(
            world.send(&[propose], &[&admin]).await,
            MarketError::Unauthorized,
        );
    }

    // Nothing pending yet.
    let accept = world.accept_admin_ix(&successor.pubkey());
    expect_market_error(
        world.send(&[accept], &[&successor]).await,
        MarketError::Unauthorized,
    );

    let propose = world.propose_admin_ix(&admin.pubkey(), successor.pubkey());
    world.send(&[propose], &[&admin]).await.unwrap();
    assert_eq!(
        world.config().await.admin,
        admin.pubkey(),
        "still the old admin"
    );

    let accept = world.accept_admin_ix(&outsider.pubkey());
    expect_market_error(
        world.send(&[accept], &[&outsider]).await,
        MarketError::Unauthorized,
    );

    let accept = world.accept_admin_ix(&successor.pubkey());
    world.send(&[accept], &[&successor]).await.unwrap();
    let config = world.config().await;
    assert_eq!(config.admin, successor.pubkey());
    assert_eq!(config.pending_admin, Default::default());

    let pause = world.set_paused_ix(&admin.pubkey(), true);
    expect_market_error(
        world.send(&[pause], &[&admin]).await,
        MarketError::Unauthorized,
    );
    let pause = world.set_paused_ix(&successor.pubkey(), true);
    world.send(&[pause], &[&successor]).await.unwrap();
}
