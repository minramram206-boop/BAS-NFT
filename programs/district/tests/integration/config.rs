//! `initialize_config` and `update_config`.

use district::constants::{APPROVED_TEMPLATE_VERSION, DISTRICT_CONFIG_VERSION};
use district::pda;

use crate::harness::*;

#[tokio::test]
async fn initialize_writes_the_config_and_template() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.version, DISTRICT_CONFIG_VERSION);
    assert_eq!(config.admin, harness.admin.pubkey());
    assert_eq!(config.pending_admin, Pubkey::default());
    assert_eq!(config.mission_authority, harness.mission_authority.pubkey());
    assert_eq!(config.sol_treasury, harness.sol_treasury);
    assert_eq!(config.collection_mint, harness.collection_mint);
    assert_eq!(config.approved_template_id, APPROVED_TEMPLATE_ID);
    assert_eq!(config.base_training_cost, BASE_TRAINING_COST);
    assert_eq!(config.total_registered_citizens, 0);
    assert_eq!(config.bump, pda::config_address().1);
    // The token launches after the program (SPEC §5.7).
    assert_eq!(config.utility_mint, Pubkey::default());
    assert!(!config.utility_mint_locked);

    let template = read_template(&mut context, &harness).await;
    assert_eq!(template.version, APPROVED_TEMPLATE_VERSION);
    assert_eq!(template.template_id, APPROVED_TEMPLATE_ID);
    assert_eq!(template.uri_prefix, APPROVED_TEMPLATE_URI_PREFIX);
    assert_eq!(
        template.bump,
        pda::approved_template_address(APPROVED_TEMPLATE_ID).1
    );
}

#[tokio::test]
async fn the_district_always_starts_paused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    assert!(read_config(&mut context, &harness).await.is_paused);
}

#[tokio::test]
async fn initialize_can_only_run_once() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    advance(&mut context, &harness).await;

    let result = send(
        &mut context,
        initialize_config_ix(
            &harness,
            harness.admin.pubkey(),
            default_init_args(&harness),
        ),
        &[&harness.admin],
    )
    .await;
    expect_account_already_in_use(result);
    assert_eq!(
        read_config(&mut context, &harness).await.admin,
        harness.admin.pubkey()
    );
}

#[tokio::test]
async fn only_the_upgrade_authority_can_initialize() {
    let (mut context, harness) = start().await;

    // Someone watching the deploy tries to take the admin seat first.
    let result = send(
        &mut context,
        initialize_config_ix(
            &harness,
            harness.impostor.pubkey(),
            default_init_args(&harness),
        ),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    assert!(!account_exists(&mut context, harness.config_key()).await);

    // An immutable program (no upgrade authority) cannot be initialized either.
    install_program_data(&mut context, &harness, None);
    let result = send(
        &mut context,
        initialize_config_ix(
            &harness,
            harness.admin.pubkey(),
            default_init_args(&harness),
        ),
        &[&harness.admin],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    assert!(!account_exists(&mut context, harness.config_key()).await);
}

#[tokio::test]
async fn initialize_rejects_a_fake_program_data_account() {
    let (mut context, harness) = start().await;

    // Same bytes, but owned by the impostor instead of the upgradeable loader.
    let real = raw_account(&mut context, harness.program_data_key()).await;
    install_account(
        &mut context,
        harness.program_data_key(),
        real.data,
        harness.impostor.pubkey(),
    );

    let result = send(
        &mut context,
        initialize_config_ix(
            &harness,
            harness.admin.pubkey(),
            default_init_args(&harness),
        ),
        &[&harness.admin],
    )
    .await;
    expect_anchor_error(
        result,
        anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram,
    );
}

#[tokio::test]
async fn initialize_rejects_empty_addresses_and_free_training() {
    let (mut context, harness) = start().await;

    type Edit = Box<dyn Fn(&mut district::InitializeConfigArgs)>;
    let cases: Vec<(&str, Edit)> = vec![
        (
            "mission authority",
            Box::new(|a| a.mission_authority = Pubkey::default()),
        ),
        ("treasury", Box::new(|a| a.sol_treasury = Pubkey::default())),
        (
            "collection",
            Box::new(|a| a.collection_mint = Pubkey::default()),
        ),
        ("free training", Box::new(|a| a.base_training_cost = 0)),
    ];
    for (label, edit) in cases {
        let mut args = default_init_args(&harness);
        edit(&mut args);
        let result = send(
            &mut context,
            initialize_config_ix(&harness, harness.admin.pubkey(), args),
            &[&harness.admin],
        )
        .await;
        let failure = result.expect_err(label);
        assert_eq!(
            custom_error_code(&failure),
            u32::from(DistrictError::InvalidConfig),
            "{label}"
        );
    }
    assert!(!account_exists(&mut context, harness.config_key()).await);
}

#[tokio::test]
async fn initialize_rejects_a_template_prefix_for_another_id() {
    let (mut context, harness) = start().await;
    let mut args = default_init_args(&harness);
    args.approved_template_uri_prefix = "https://metadata.example.invalid/templates/8/".to_string();

    let result = send(
        &mut context,
        initialize_config_ix(&harness, harness.admin.pubkey(), args),
        &[&harness.admin],
    )
    .await;
    expect_error(result, DistrictError::InvalidAssetState);
}

fn update_args(mission_authority: Pubkey, sol_treasury: Pubkey, cost: u64) -> UpdateConfigArgs {
    UpdateConfigArgs {
        mission_authority,
        sol_treasury,
        base_training_cost: cost,
    }
}

#[tokio::test]
async fn update_config_changes_operational_parameters_only() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let mission_authority = Pubkey::new_unique();
    let treasury = Pubkey::new_unique();
    send(
        &mut context,
        update_config_ix(
            &harness,
            harness.admin.pubkey(),
            update_args(mission_authority, treasury, BASE_TRAINING_COST * 2),
        ),
        &[&harness.admin],
    )
    .await
    .expect("the admin can update operational parameters");

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.mission_authority, mission_authority);
    assert_eq!(config.sol_treasury, treasury);
    assert_eq!(config.base_training_cost, BASE_TRAINING_COST * 2);

    // Nothing else is reachable from this instruction.
    assert_eq!(config.admin, harness.admin.pubkey());
    assert_eq!(config.collection_mint, harness.collection_mint);
    assert_eq!(config.utility_mint, harness.utility_mint.pubkey());
    assert!(config.utility_mint_locked);
    assert!(!config.is_paused);
    assert_eq!(config.approved_template_id, APPROVED_TEMPLATE_ID);
    assert_eq!(
        read_template(&mut context, &harness).await.uri_prefix,
        APPROVED_TEMPLATE_URI_PREFIX
    );
}

#[tokio::test]
async fn update_config_rejects_empty_addresses_and_free_training() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let valid = Pubkey::new_unique();
    for (index, args) in [
        update_args(Pubkey::default(), valid, BASE_TRAINING_COST),
        update_args(valid, Pubkey::default(), BASE_TRAINING_COST),
        update_args(valid, valid, 0),
    ]
    .into_iter()
    .enumerate()
    {
        let result = send(
            &mut context,
            update_config_ix(&harness, harness.admin.pubkey(), args),
            &[&harness.admin],
        )
        .await;
        let failure = result.expect_err("an invalid update must fail");
        assert_eq!(
            custom_error_code(&failure),
            u32::from(DistrictError::InvalidConfig),
            "case {index}"
        );
    }

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.mission_authority, harness.mission_authority.pubkey());
    assert_eq!(config.base_training_cost, BASE_TRAINING_COST);
}

#[tokio::test]
async fn only_the_admin_can_update_config() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let result = send(
        &mut context,
        update_config_ix(
            &harness,
            harness.impostor.pubkey(),
            update_args(harness.impostor.pubkey(), harness.impostor.pubkey(), 1),
        ),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    assert_eq!(
        read_config(&mut context, &harness).await.mission_authority,
        harness.mission_authority.pubkey()
    );
}
