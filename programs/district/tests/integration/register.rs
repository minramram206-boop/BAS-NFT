//! `register_citizen` (SPEC §6.3).

use district::constants::{CITIZEN_STATE_VERSION, STAT_MAX};
use district::mpl_core;

use crate::harness::*;

async fn try_register(
    context: &mut ProgramTestContext,
    harness: &Harness,
    asset: Pubkey,
    signer: &Keypair,
) -> SendResult {
    send(
        context,
        register_ix(harness, asset, signer.pubkey()),
        &[signer],
    )
    .await
}

async fn registered_count(context: &mut ProgramTestContext, harness: &Harness) -> u32 {
    read_config(context, harness)
        .await
        .total_registered_citizens
}

#[tokio::test]
async fn registers_a_genuine_collection_member() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(citizen.version, CITIZEN_STATE_VERSION);
    assert_eq!(citizen.asset, asset);
    assert_eq!(citizen.citizen_id, 1);
    assert_eq!(citizen.role, CitizenRole::Pioneer as u8);
    assert_eq!(citizen.bump, district::pda::citizen_address(&asset).1);
    assert_eq!(
        (
            citizen.insight_training_credits,
            citizen.bond_training_credits,
            citizen.craft_training_credits
        ),
        (0, 0, 0),
        "credits are earned through missions, never granted at registration"
    );
    assert_eq!(registered_count(&mut context, &harness).await, 1);
}

#[tokio::test]
async fn the_role_and_its_stats_come_from_the_metadata_file() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    for index in 0..ROLE_COUNT as u8 {
        let role = CitizenRole::from_index(index).expect("a known role");
        let (_, citizen_state) = register_role(&mut context, &harness, role).await;
        let citizen = read_citizen(&mut context, citizen_state).await;
        let template = role.template();
        assert_eq!(citizen.role, index, "{}", template.code_name);
        assert_eq!(
            (citizen.intelligence, citizen.alignment, citizen.compute),
            (
                template.initial_intelligence,
                template.initial_alignment,
                template.initial_compute
            )
        );
        assert!([citizen.intelligence, citizen.alignment, citizen.compute]
            .iter()
            .all(|s| *s < STAT_MAX));
    }
    assert_eq!(
        registered_count(&mut context, &harness).await,
        ROLE_COUNT as u32
    );
}

#[tokio::test]
async fn citizen_ids_count_up_from_one() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let mut ids = Vec::new();
    for _ in 0..3 {
        let (_, citizen_state) = register_member(&mut context, &harness).await;
        ids.push(read_citizen(&mut context, citizen_state).await.citizen_id);
    }
    assert_eq!(ids, vec![1, 2, 3]);
}

#[tokio::test]
async fn rejects_an_asset_from_a_foreign_collection() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        asset,
        core_asset(&harness.holder.pubkey(), &Pubkey::new_unique()),
    );
    expect_error(
        try_register(&mut context, &harness, asset, &harness.holder).await,
        DistrictError::InvalidCollection,
    );
    assert_eq!(registered_count(&mut context, &harness).await, 0);
}

#[tokio::test]
async fn rejects_an_asset_the_signer_does_not_own() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let asset = install_member(&mut context, &harness);

    expect_error(
        try_register(&mut context, &harness, asset, &harness.impostor).await,
        DistrictError::NotOwner,
    );
    assert_eq!(registered_count(&mut context, &harness).await, 0);
}

#[tokio::test]
async fn rejects_a_forged_asset_written_by_any_other_program() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // Perfect member bytes in an account owned by a program the attacker
    // deployed, by the attacker's wallet, and by the district program itself.
    // Before the Core program id was pinned, the first case registered.
    let forged = core_asset(&harness.holder.pubkey(), &harness.collection_mint);
    for owner in [Pubkey::new_unique(), harness.holder.pubkey(), district::ID] {
        let asset = Pubkey::new_unique();
        install_account(&mut context, asset, forged.clone(), owner);
        expect_error(
            try_register(&mut context, &harness, asset, &harness.holder).await,
            DistrictError::InvalidAssetState,
        );
    }
    assert_eq!(registered_count(&mut context, &harness).await, 0);
}

#[tokio::test]
async fn rejects_core_accounts_that_are_not_member_assets() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let member = core_asset(&harness.holder.pubkey(), &harness.collection_mint);
    let with_byte = |offset: usize, value: u8| {
        let mut data = member.clone();
        data[offset] = value;
        data
    };
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty", vec![]),
        ("uninitialized", with_byte(0, 0)),
        ("compressed", with_byte(0, mpl_core::KEY_HASHED_ASSET_V1)),
        (
            "collection account",
            with_byte(0, mpl_core::KEY_COLLECTION_V1),
        ),
        (
            "standalone asset",
            with_byte(mpl_core::UPDATE_AUTHORITY_TAG_OFFSET, 1),
        ),
        (
            "truncated",
            member[..mpl_core::MIN_ASSET_PREFIX_LEN - 1].to_vec(),
        ),
    ];

    for (label, data) in cases {
        let asset = Pubkey::new_unique();
        install_asset(&mut context, asset, data);
        let failure = try_register(&mut context, &harness, asset, &harness.holder)
            .await
            .expect_err(label);
        assert_eq!(
            custom_error_code(&failure),
            u32::from(DistrictError::InvalidAssetState),
            "{label}"
        );
    }
    assert_eq!(registered_count(&mut context, &harness).await, 0);
}

#[tokio::test]
async fn rejects_an_unapproved_metadata_uri() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        asset,
        core_asset_with_uri(
            &harness.holder.pubkey(),
            &harness.collection_mint,
            "https://metadata.example.invalid/templates/8/citizen-13.json",
        ),
    );
    expect_error(
        try_register(&mut context, &harness, asset, &harness.holder).await,
        DistrictError::InvalidMetadataUri,
    );
    assert!(!account_exists(&mut context, harness.citizen_pda(&asset)).await);
}

#[tokio::test]
async fn rejects_metadata_files_that_name_no_role() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // Each URI passes the approved-template check; only the role is wrong.
    for file_name in [
        "013.json",
        "pioneer.json",
        "013-wizard.json",
        "013-Navigator.json",
        "013-navigator-2.json",
    ] {
        let uri = format!("{APPROVED_TEMPLATE_URI_PREFIX}{file_name}");
        let asset = install_member_with_uri(&mut context, &harness, &uri);
        let failure = try_register(&mut context, &harness, asset, &harness.holder)
            .await
            .expect_err(file_name);
        assert_eq!(
            custom_error_code(&failure),
            u32::from(DistrictError::InvalidRole),
            "{file_name}"
        );
    }
    assert_eq!(registered_count(&mut context, &harness).await, 0);
}

#[tokio::test]
async fn the_same_asset_cannot_register_twice() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;
    let first = read_citizen(&mut context, citizen_state).await;

    advance(&mut context, &harness).await;
    let result = try_register(&mut context, &harness, asset, &harness.holder).await;
    expect_account_already_in_use(result);

    let after = read_citizen(&mut context, citizen_state).await;
    assert_eq!(
        (after.citizen_id, after.role),
        (first.citizen_id, first.role)
    );
    assert_eq!(registered_count(&mut context, &harness).await, 1);
}
