//! `claim_training_credit` (SPEC §12, §15.3 tests 1-3).

use anchor_lang::solana_program::system_program;
use solana_sdk::account::AccountSharedData;

use crate::harness::*;

async fn credits(context: &mut ProgramTestContext, citizen_state: Pubkey) -> (u16, u16, u16) {
    let citizen = read_citizen(context, citizen_state).await;
    (
        citizen.insight_training_credits,
        citizen.bond_training_credits,
        citizen.craft_training_credits,
    )
}

#[tokio::test]
async fn an_authorized_claim_adds_one_matching_credit_and_a_receipt() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let args = claim_args(CitizenStat::Alignment, 11, 4242);
    send_claim(&mut context, &harness, asset, args)
        .await
        .expect("an authorized claim succeeds");
    assert_eq!(credits(&mut context, citizen_state).await, (0, 1, 0));

    let receipt = read_receipt(&mut context, harness.claim_receipt_pda(&asset, 11, 4242)).await;
    assert_eq!(receipt.asset, asset);
    assert_eq!(receipt.owner, harness.holder.pubkey());
    assert_eq!(
        (receipt.mission_id, receipt.season_id, receipt.nonce),
        (11, 1, 4242)
    );
    assert_eq!(receipt.stat, CitizenStat::Alignment as u8);
    assert_eq!(
        (receipt.expires_at, receipt.claimed_at),
        (NOW + AN_HOUR, NOW)
    );
}

#[tokio::test]
async fn a_claim_cannot_be_replayed() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let args = claim_args(CitizenStat::Intelligence, 21, 77);
    send_claim(&mut context, &harness, asset, args)
        .await
        .expect("the first claim succeeds");
    advance(&mut context, &harness).await;
    expect_error(
        send_claim(&mut context, &harness, asset, args).await,
        DistrictError::MissionClaimAlreadyUsed,
    );
    assert_eq!(credits(&mut context, citizen_state).await, (1, 0, 0));
}

#[tokio::test]
async fn a_prefunded_receipt_address_does_not_block_the_claim() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // Anyone can send lamports to a predictable PDA. A plain `create_account`
    // would then fail and the claim could never be used.
    let receipt = harness.claim_receipt_pda(&asset, 31, 1);
    context.set_account(&receipt, &AccountSharedData::new(1, 0, &system_program::ID));

    send_claim(
        &mut context,
        &harness,
        asset,
        claim_args(CitizenStat::Compute, 31, 1),
    )
    .await
    .expect("a prefunded receipt address is still usable");
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 1));
    assert_eq!(read_receipt(&mut context, receipt).await.mission_id, 31);
}

#[tokio::test]
async fn an_expired_claim_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    for (nonce, expires_at) in [(1u64, NOW - 1), (2, NOW), (3, i64::MIN)] {
        let mut args = claim_args(CitizenStat::Intelligence, 41, nonce);
        args.expires_at = expires_at;
        expect_error(
            send_claim(&mut context, &harness, asset, args).await,
            DistrictError::MissionClaimExpired,
        );
    }
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 0));
}

#[tokio::test]
async fn a_claim_by_someone_who_does_not_hold_the_asset_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let args = claim_args(CitizenStat::Intelligence, 51, 1);
    let mut accounts = ClaimAccounts::for_holder(&harness, asset, &args);
    accounts.owner = harness.impostor.pubkey();
    let result = send(
        &mut context,
        claim_ix(&harness, &accounts, args),
        &[&harness.impostor, &harness.mission_authority],
    )
    .await;
    expect_error(result, DistrictError::NotOwner);
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 0));
}

#[tokio::test]
async fn a_credit_cannot_land_on_another_assets_citizen() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (_, victim_state) = register_member(&mut context, &harness).await;
    let (own_asset, own_state) = register_member(&mut context, &harness).await;

    // Ownership is proven for `own_asset`, but the credit is aimed elsewhere.
    let args = claim_args(CitizenStat::Intelligence, 52, 1);
    let mut accounts = ClaimAccounts::for_holder(&harness, own_asset, &args);
    accounts.citizen_state = victim_state;
    let result = send(
        &mut context,
        claim_ix(&harness, &accounts, args),
        &[&harness.holder, &harness.mission_authority],
    )
    .await;
    expect_anchor_error(result, anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(credits(&mut context, victim_state).await, (0, 0, 0));
    assert_eq!(credits(&mut context, own_state).await, (0, 0, 0));
}

#[tokio::test]
async fn the_receipt_address_must_match_the_claim() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let args = claim_args(CitizenStat::Intelligence, 53, 1);
    let mut accounts = ClaimAccounts::for_holder(&harness, asset, &args);
    accounts.receipt = harness.claim_receipt_pda(&asset, 53, 2);
    let result = send(
        &mut context,
        claim_ix(&harness, &accounts, args),
        &[&harness.holder, &harness.mission_authority],
    )
    .await;
    expect_anchor_error(result, anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 0));
}

#[tokio::test]
async fn a_claim_without_the_mission_authority_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // Another signer in the authority slot, including the holder appointing
    // themselves, is refused by the constraint against the config.
    for (nonce, stand_in) in [(1u64, &harness.impostor), (2, &harness.holder)] {
        let args = claim_args(CitizenStat::Intelligence, 54, nonce);
        let mut accounts = ClaimAccounts::for_holder(&harness, asset, &args);
        accounts.mission_authority = stand_in.pubkey();
        let result = send(
            &mut context,
            claim_ix(&harness, &accounts, args),
            &[&harness.holder, stand_in],
        )
        .await;
        expect_error(result, DistrictError::InvalidMissionClaim);
    }
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 0));
}

#[tokio::test]
async fn a_claim_for_an_unknown_stat_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    for stat in [3u8, 9, 255] {
        let mut args = claim_args(CitizenStat::Intelligence, 61, u64::from(stat));
        args.stat = stat;
        expect_error(
            send_claim(&mut context, &harness, asset, args).await,
            DistrictError::InvalidStat,
        );
    }
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 0));
}

#[tokio::test]
async fn a_forged_asset_cannot_claim() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // Rewrite the real asset address as an account owned by another program.
    let data = raw_account(&mut context, asset).await.data;
    install_account(&mut context, asset, data, Pubkey::new_unique());

    expect_error(
        send_claim(
            &mut context,
            &harness,
            asset,
            claim_args(CitizenStat::Intelligence, 62, 1),
        )
        .await,
        DistrictError::InvalidAssetState,
    );
    assert_eq!(credits(&mut context, citizen_state).await, (0, 0, 0));
}
