//! `set_utility_mint` and `lock_utility_mint` (SPEC §5.2, §15.4).

use crate::harness::*;

async fn try_bind(context: &mut ProgramTestContext, harness: &Harness, mint: Pubkey) -> SendResult {
    send(
        context,
        set_utility_mint_ix(harness, harness.admin.pubkey(), mint),
        &[&harness.admin],
    )
    .await
}

#[tokio::test]
async fn the_mint_can_be_replaced_until_it_is_locked() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    bind_utility_mint(&mut context, &harness, TokenFlavor::Spl).await;

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.utility_mint, harness.utility_mint.pubkey());
    assert!(!config.utility_mint_locked);

    let replacement = Pubkey::new_unique();
    let authority = context.payer.pubkey();
    context.set_account(
        &replacement,
        &mint_account(TokenFlavor::Spl, &authority, TOKEN_SUPPLY),
    );
    try_bind(&mut context, &harness, replacement)
        .await
        .expect("an unlocked mint is replaceable");
    assert_eq!(
        read_config(&mut context, &harness).await.utility_mint,
        replacement
    );
}

#[tokio::test]
async fn the_mint_cannot_change_after_the_lock() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    bind_utility_mint(&mut context, &harness, TokenFlavor::Spl).await;
    send(
        &mut context,
        lock_utility_mint_ix(&harness, harness.admin.pubkey()),
        &[&harness.admin],
    )
    .await
    .expect("the admin can lock");
    assert!(
        read_config(&mut context, &harness)
            .await
            .utility_mint_locked
    );

    let replacement = Pubkey::new_unique();
    let authority = context.payer.pubkey();
    context.set_account(
        &replacement,
        &mint_account(TokenFlavor::Spl, &authority, TOKEN_SUPPLY),
    );
    expect_error(
        try_bind(&mut context, &harness, replacement).await,
        DistrictError::UtilityMintLocked,
    );

    advance(&mut context, &harness).await;
    let result = send(
        &mut context,
        lock_utility_mint_ix(&harness, harness.admin.pubkey()),
        &[&harness.admin],
    )
    .await;
    expect_error(result, DistrictError::UtilityMintLocked);
    assert_eq!(
        read_config(&mut context, &harness).await.utility_mint,
        harness.utility_mint.pubkey()
    );
}

#[tokio::test]
async fn an_account_that_is_not_an_initialized_mint_is_refused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    for (label, data) in [("zeroed", vec![0u8; 82]), ("too short", vec![0u8; 8])] {
        let address = Pubkey::new_unique();
        context.set_account(&address, &owned_by(TokenFlavor::Spl.program_id(), data));
        let result = try_bind(&mut context, &harness, address).await;
        let failure = result.expect_err(label);
        assert_eq!(
            custom_error_code(&failure),
            u32::from(DistrictError::InvalidUtilityMint),
            "{label}"
        );
    }
    assert_eq!(
        read_config(&mut context, &harness).await.utility_mint,
        Pubkey::default()
    );
}

#[tokio::test]
async fn a_mint_owned_by_an_unknown_program_is_refused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // Valid mint bytes, but written by a program that is not a token program.
    let address = Pubkey::new_unique();
    let authority = context.payer.pubkey();
    let mut forged = mint_account(TokenFlavor::Spl, &authority, TOKEN_SUPPLY);
    forged.set_owner(Pubkey::new_unique());
    context.set_account(&address, &forged);

    expect_error(
        try_bind(&mut context, &harness, address).await,
        DistrictError::InvalidTokenProgram,
    );
}

#[tokio::test]
async fn a_mint_with_unexpected_decimals_is_refused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let address = Pubkey::new_unique();
    let authority = context.payer.pubkey();
    context.set_account(
        &address,
        &mint_account_with_decimals(
            TokenFlavor::Spl,
            &authority,
            TOKEN_SUPPLY,
            TOKEN_DECIMALS + 3,
        ),
    );
    expect_error(
        try_bind(&mut context, &harness, address).await,
        DistrictError::InvalidUtilityMint,
    );

    // The same mint binds once the caller states its real decimals.
    send(
        &mut context,
        set_utility_mint_with_decimals_ix(
            &harness,
            harness.admin.pubkey(),
            address,
            TOKEN_DECIMALS + 3,
        ),
        &[&harness.admin],
    )
    .await
    .expect("matching decimals bind");
}

#[tokio::test]
async fn a_token_2022_mint_can_be_bound() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    bind_utility_mint(&mut context, &harness, TokenFlavor::Token2022).await;
    assert_eq!(
        read_config(&mut context, &harness).await.utility_mint,
        harness.utility_mint.pubkey()
    );
}

#[tokio::test]
async fn locking_before_a_mint_is_bound_is_refused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let result = send(
        &mut context,
        lock_utility_mint_ix(&harness, harness.admin.pubkey()),
        &[&harness.admin],
    )
    .await;
    expect_error(result, DistrictError::UtilityMintNotSet);
    assert!(
        !read_config(&mut context, &harness)
            .await
            .utility_mint_locked
    );
}

#[tokio::test]
async fn only_the_admin_can_touch_the_mint() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let authority = context.payer.pubkey();
    context.set_account(
        &harness.utility_mint.pubkey(),
        &mint_account(TokenFlavor::Spl, &authority, TOKEN_SUPPLY),
    );

    let result = send(
        &mut context,
        set_utility_mint_ix(
            &harness,
            harness.impostor.pubkey(),
            harness.utility_mint.pubkey(),
        ),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);

    let result = send(
        &mut context,
        lock_utility_mint_ix(&harness, harness.impostor.pubkey()),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.utility_mint, Pubkey::default());
    assert!(!config.utility_mint_locked);
}
