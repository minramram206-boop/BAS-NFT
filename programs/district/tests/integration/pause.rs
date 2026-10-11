//! `set_paused` and the release order it enforces (SPEC §5.2, §5.7).

use crate::harness::*;

async fn try_set_paused(
    context: &mut ProgramTestContext,
    harness: &Harness,
    paused: bool,
) -> SendResult {
    send(
        context,
        set_paused_ix(harness, harness.admin.pubkey(), paused),
        &[&harness.admin],
    )
    .await
}

#[tokio::test]
async fn the_district_cannot_resume_without_a_mint() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    expect_error(
        try_set_paused(&mut context, &harness, false).await,
        DistrictError::UtilityMintNotLocked,
    );
    assert!(read_config(&mut context, &harness).await.is_paused);
}

#[tokio::test]
async fn the_district_resumes_only_after_the_mint_is_locked() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    bind_utility_mint(&mut context, &harness, TokenFlavor::Spl).await;

    expect_error(
        try_set_paused(&mut context, &harness, false).await,
        DistrictError::UtilityMintNotLocked,
    );
    assert!(read_config(&mut context, &harness).await.is_paused);

    // The successful unpause below is byte-identical to the refused one.
    advance(&mut context, &harness).await;
    lock_and_unpause(&mut context, &harness).await;
    assert!(!read_config(&mut context, &harness).await.is_paused);
}

#[tokio::test]
async fn only_the_admin_can_pause() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let result = send(
        &mut context,
        set_paused_ix(&harness, harness.impostor.pubkey(), true),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    assert!(!read_config(&mut context, &harness).await.is_paused);
}

#[tokio::test]
async fn pausing_twice_is_harmless_and_resuming_works() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    try_set_paused(&mut context, &harness, true)
        .await
        .expect("the admin can pause");
    let before = read_config(&mut context, &harness).await;
    assert!(before.is_paused);

    advance(&mut context, &harness).await;
    try_set_paused(&mut context, &harness, true)
        .await
        .expect("repeating a value succeeds");
    let after = read_config(&mut context, &harness).await;
    assert_eq!(
        (
            after.admin,
            after.utility_mint,
            after.base_training_cost,
            after.total_registered_citizens
        ),
        (
            before.admin,
            before.utility_mint,
            before.base_training_cost,
            before.total_registered_citizens
        )
    );

    try_set_paused(&mut context, &harness, false)
        .await
        .expect("the admin can resume");
    assert!(!read_config(&mut context, &harness).await.is_paused);
}

#[tokio::test]
async fn pausing_blocks_registration_claims_and_upgrades() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        1,
    )
    .await;
    try_set_paused(&mut context, &harness, true)
        .await
        .expect("the admin can pause");

    let asset = install_member(&mut context, &harness);
    let result = send(
        &mut context,
        register_ix(&harness, asset, harness.holder.pubkey()),
        &[&harness.holder],
    )
    .await;
    expect_error(result, DistrictError::ProgramPaused);

    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::ProgramPaused,
    );
    expect_error(
        send_claim(
            &mut context,
            &harness,
            setup.asset(),
            claim_args(CitizenStat::Intelligence, 99, 99),
        )
        .await,
        DistrictError::ProgramPaused,
    );

    let citizen = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(citizen.insight_training_credits, 1);
    assert_eq!(citizen.intelligence, 1);
    assert_eq!(
        read_config(&mut context, &harness)
            .await
            .total_registered_citizens,
        1
    );
}
