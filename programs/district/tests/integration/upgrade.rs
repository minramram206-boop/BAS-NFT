//! `upgrade_score` (SPEC §5.3, §15.3 tests 4-14, §15.4).

use district::constants::STAT_MAX;

use crate::harness::*;

async fn try_upgrade(
    context: &mut ProgramTestContext,
    harness: &Harness,
    accounts: &UpgradeAccounts,
    signer: &Keypair,
    stat_index: u8,
) -> SendResult {
    send(
        context,
        upgrade_ix(harness, accounts, stat_index),
        &[signer],
    )
    .await
}

#[tokio::test]
async fn an_upgrade_burns_the_formula_cost_and_raises_one_stat() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        71,
    )
    .await;

    let balance_before = token_balance(&mut context, setup.user_token_account()).await;
    let supply_before = token_supply(&mut context, harness.utility_mint.pubkey()).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence)
        .await
        .expect("an owner with a credit and tokens can upgrade");

    let citizen = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(
        (citizen.intelligence, citizen.alignment, citizen.compute),
        (2, 1, 1)
    );
    assert_eq!(citizen.insight_training_credits, 0);

    // Pioneer starts at 1, so the cost is 100 × (1 + 1). Supply dropping
    // proves a burn rather than a transfer.
    let cost = BASE_TRAINING_COST * 2;
    assert_eq!(
        balance_before - token_balance(&mut context, setup.user_token_account()).await,
        cost
    );
    assert_eq!(
        supply_before - token_supply(&mut context, harness.utility_mint.pubkey()).await,
        cost
    );
}

#[tokio::test]
async fn a_token_2022_utility_token_trains_the_same_way() {
    let (mut context, harness) = start().await;
    bootstrap_with(&mut context, &harness, TokenFlavor::Token2022).await;
    let setup =
        setup_training_with(&mut context, &harness, 1_000_000, TokenFlavor::Token2022).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Compute,
        72,
    )
    .await;

    let supply_before = token_supply(&mut context, harness.utility_mint.pubkey()).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Compute)
        .await
        .expect("a Token-2022 mint must be burnable");
    assert_eq!(
        supply_before - token_supply(&mut context, harness.utility_mint.pubkey()).await,
        BASE_TRAINING_COST * 2
    );
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .compute,
        2
    );
}

#[tokio::test]
async fn the_token_program_must_own_the_mint() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        73,
    )
    .await;

    let mut accounts = setup.accounts;
    accounts.token_program = TokenFlavor::Token2022.program_id();
    let result = try_upgrade(&mut context, &harness, &accounts, &harness.holder, 0).await;
    expect_anchor_error(
        result,
        anchor_lang::error::ErrorCode::ConstraintMintTokenProgram,
    );
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .intelligence,
        1
    );
}

#[tokio::test]
async fn the_cost_rises_with_the_score() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        81,
    )
    .await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        82,
    )
    .await;

    let start_supply = token_supply(&mut context, harness.utility_mint.pubkey()).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence)
        .await
        .expect("1 -> 2");
    let after_first = token_supply(&mut context, harness.utility_mint.pubkey()).await;
    advance(&mut context, &harness).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence)
        .await
        .expect("2 -> 3");
    let after_second = token_supply(&mut context, harness.utility_mint.pubkey()).await;

    assert_eq!(start_supply - after_first, BASE_TRAINING_COST * 2);
    assert_eq!(after_first - after_second, BASE_TRAINING_COST * 3);
    let citizen = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(citizen.intelligence, 3);
    assert_eq!(citizen.tier_of(CitizenStat::Intelligence), 1);
}

#[tokio::test]
async fn an_upgrade_needs_a_credit_of_the_same_stat() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::InsufficientTrainingCredits,
    );

    // A Bond credit does not pay for Insight.
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Alignment,
        91,
    )
    .await;
    advance(&mut context, &harness).await;
    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::InsufficientTrainingCredits,
    );
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .bond_training_credits,
        1
    );

    upgrade(&mut context, &harness, &setup, CitizenStat::Alignment)
        .await
        .expect("a Bond credit pays for Bond");
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .alignment,
        2
    );
}

#[tokio::test]
async fn an_upgrade_is_refused_without_a_bound_or_locked_mint() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        101,
    )
    .await;

    // Neither state is reachable through instructions any more, because
    // unpausing requires the lock. They are written directly to prove the
    // upgrade path checks them on its own.
    overwrite_config(&mut context, &harness, |config| {
        config.utility_mint = Pubkey::default();
        config.utility_mint_locked = false;
    })
    .await;
    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::UtilityMintNotSet,
    );

    let mint = harness.utility_mint.pubkey();
    overwrite_config(&mut context, &harness, |config| config.utility_mint = mint).await;
    advance(&mut context, &harness).await;
    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::UtilityMintNotLocked,
    );

    let citizen = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(
        (citizen.intelligence, citizen.insight_training_credits),
        (1, 1)
    );
}

#[tokio::test]
async fn a_foreign_mint_is_refused_even_when_burnable() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        111,
    )
    .await;

    let foreign_mint = Pubkey::new_unique();
    let foreign_account = Pubkey::new_unique();
    let authority = context.payer.pubkey();
    context.set_account(
        &foreign_mint,
        &mint_account(TokenFlavor::Spl, &authority, TOKEN_SUPPLY),
    );
    context.set_account(
        &foreign_account,
        &token_account(
            TokenFlavor::Spl,
            &foreign_mint,
            &harness.holder.pubkey(),
            1_000_000,
        ),
    );

    let mut wrong_account = setup.accounts;
    wrong_account.user_token_account = foreign_account;
    expect_error(
        try_upgrade(&mut context, &harness, &wrong_account, &harness.holder, 0).await,
        DistrictError::InvalidUtilityMint,
    );

    let mut wrong_mint = setup.accounts;
    wrong_mint.utility_mint = foreign_mint;
    expect_error(
        try_upgrade(&mut context, &harness, &wrong_mint, &harness.holder, 0).await,
        DistrictError::InvalidUtilityMint,
    );

    assert_eq!(token_supply(&mut context, foreign_mint).await, TOKEN_SUPPLY);
    assert_eq!(
        token_supply(&mut context, harness.utility_mint.pubkey()).await,
        TOKEN_SUPPLY
    );
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .insight_training_credits,
        1
    );
}

#[tokio::test]
async fn someone_elses_token_account_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        121,
    )
    .await;

    let impostor_account = Pubkey::new_unique();
    context.set_account(
        &impostor_account,
        &token_account(
            TokenFlavor::Spl,
            &harness.utility_mint.pubkey(),
            &harness.impostor.pubkey(),
            1_000_000,
        ),
    );
    let mut accounts = setup.accounts;
    accounts.user_token_account = impostor_account;
    expect_error(
        try_upgrade(&mut context, &harness, &accounts, &harness.holder, 0).await,
        DistrictError::NotOwner,
    );
    assert_eq!(
        token_balance(&mut context, impostor_account).await,
        1_000_000
    );
}

#[tokio::test]
async fn a_maxed_stat_cannot_be_raised() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    let mut citizen = citizen_fixture(setup.asset(), CitizenRole::Pioneer);
    citizen.intelligence = STAT_MAX;
    citizen.insight_training_credits = 1;
    install_citizen(&mut context, setup.citizen_state(), &citizen);

    let supply_before = token_supply(&mut context, harness.utility_mint.pubkey()).await;
    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::MaxScore,
    );
    let after = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(
        (after.intelligence, after.insight_training_credits),
        (STAT_MAX, 1)
    );
    assert_eq!(
        token_supply(&mut context, harness.utility_mint.pubkey()).await,
        supply_before
    );

    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Compute,
        131,
    )
    .await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Compute)
        .await
        .expect("Craft is not maxed");
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .compute,
        2
    );
}

#[tokio::test]
async fn an_unaffordable_upgrade_reports_the_balance() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, BASE_TRAINING_COST).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        141,
    )
    .await;

    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::InsufficientTokenBalance,
    );
    let citizen = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(
        (citizen.intelligence, citizen.insight_training_credits),
        (1, 1)
    );
    assert_eq!(
        token_balance(&mut context, setup.user_token_account()).await,
        BASE_TRAINING_COST
    );
}

#[tokio::test]
async fn an_unknown_stat_index_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        151,
    )
    .await;

    for stat_index in [3u8, 9, 255] {
        expect_error(
            try_upgrade(
                &mut context,
                &harness,
                &setup.accounts,
                &harness.holder,
                stat_index,
            )
            .await,
            DistrictError::InvalidStat,
        );
    }
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .insight_training_credits,
        1
    );
}

#[tokio::test]
async fn only_the_current_holder_can_upgrade() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        161,
    )
    .await;

    let impostor_account = Pubkey::new_unique();
    context.set_account(
        &impostor_account,
        &token_account(
            TokenFlavor::Spl,
            &harness.utility_mint.pubkey(),
            &harness.impostor.pubkey(),
            1_000_000,
        ),
    );
    let mut accounts = setup.accounts;
    accounts.owner = harness.impostor.pubkey();
    accounts.user_token_account = impostor_account;
    expect_error(
        try_upgrade(&mut context, &harness, &accounts, &harness.impostor, 0).await,
        DistrictError::NotOwner,
    );
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .intelligence,
        1
    );
}

#[tokio::test]
async fn a_transferred_citizen_follows_its_new_holder() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    // A transfer rewrites the owner on the Core asset; nothing else changes.
    install_asset(
        &mut context,
        setup.asset(),
        core_asset(&harness.successor.pubkey(), &harness.collection_mint),
    );
    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::NotOwner,
    );

    let args = claim_args(CitizenStat::Intelligence, 171, 1);
    let mut claim = ClaimAccounts::for_holder(&harness, setup.asset(), &args);
    claim.owner = harness.successor.pubkey();
    send(
        &mut context,
        claim_ix(&harness, &claim, args),
        &[&harness.successor, &harness.mission_authority],
    )
    .await
    .expect("the new holder can claim");

    let successor_account = Pubkey::new_unique();
    context.set_account(
        &successor_account,
        &token_account(
            TokenFlavor::Spl,
            &harness.utility_mint.pubkey(),
            &harness.successor.pubkey(),
            1_000_000,
        ),
    );
    let mut accounts = setup.accounts;
    accounts.owner = harness.successor.pubkey();
    accounts.user_token_account = successor_account;
    try_upgrade(&mut context, &harness, &accounts, &harness.successor, 0)
        .await
        .expect("the new holder can train");
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .intelligence,
        2
    );
}

#[tokio::test]
async fn an_asset_that_left_the_collection_cannot_train() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        181,
    )
    .await;

    install_asset(
        &mut context,
        setup.asset(),
        core_asset(&harness.holder.pubkey(), &Pubkey::new_unique()),
    );
    expect_error(
        upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await,
        DistrictError::InvalidCollection,
    );
    let citizen = read_citizen(&mut context, setup.citizen_state()).await;
    assert_eq!(
        (citizen.intelligence, citizen.insight_training_credits),
        (1, 1)
    );
}

#[tokio::test]
async fn a_citizen_cannot_be_trained_through_another_asset() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset(),
        CitizenStat::Intelligence,
        191,
    )
    .await;
    let (other_asset, _) = register_member(&mut context, &harness).await;

    let mut accounts = setup.accounts;
    accounts.asset = other_asset;
    expect_anchor_error(
        try_upgrade(&mut context, &harness, &accounts, &harness.holder, 0).await,
        anchor_lang::error::ErrorCode::ConstraintSeeds,
    );
    assert_eq!(
        read_citizen(&mut context, setup.citizen_state())
            .await
            .intelligence,
        1
    );
}
