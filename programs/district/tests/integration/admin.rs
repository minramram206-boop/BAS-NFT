//! `propose_admin` and `accept_admin`.

use crate::harness::*;

async fn propose(
    context: &mut ProgramTestContext,
    harness: &Harness,
    proposed: Pubkey,
) -> SendResult {
    send(
        context,
        propose_admin_ix(harness, harness.admin.pubkey(), proposed),
        &[&harness.admin],
    )
    .await
}

#[tokio::test]
async fn admin_moves_only_through_propose_then_accept() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    propose(&mut context, &harness, harness.successor.pubkey())
        .await
        .expect("the admin can propose");
    let config = read_config(&mut context, &harness).await;
    assert_eq!(
        (config.admin, config.pending_admin),
        (harness.admin.pubkey(), harness.successor.pubkey())
    );

    // Until acceptance the current admin keeps full authority.
    send(
        &mut context,
        set_paused_ix(&harness, harness.admin.pubkey(), true),
        &[&harness.admin],
    )
    .await
    .expect("the current admin can still pause");

    let result = send(
        &mut context,
        accept_admin_ix(&harness, harness.impostor.pubkey()),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);

    send(
        &mut context,
        accept_admin_ix(&harness, harness.successor.pubkey()),
        &[&harness.successor],
    )
    .await
    .expect("the proposed successor can accept");
    let config = read_config(&mut context, &harness).await;
    assert_eq!(
        (config.admin, config.pending_admin),
        (harness.successor.pubkey(), Pubkey::default())
    );

    advance(&mut context, &harness).await;
    let result = send(
        &mut context,
        set_paused_ix(&harness, harness.admin.pubkey(), false),
        &[&harness.admin],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    send(
        &mut context,
        set_paused_ix(&harness, harness.successor.pubkey(), false),
        &[&harness.successor],
    )
    .await
    .expect("the new admin has authority");
}

#[tokio::test]
async fn accepting_without_a_proposal_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let result = send(
        &mut context,
        accept_admin_ix(&harness, harness.successor.pubkey()),
        &[&harness.successor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    assert_eq!(
        read_config(&mut context, &harness).await.admin,
        harness.admin.pubkey()
    );
}

#[tokio::test]
async fn proposing_yourself_or_nobody_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    expect_error(
        propose(&mut context, &harness, harness.admin.pubkey()).await,
        DistrictError::Unauthorized,
    );
    expect_error(
        propose(&mut context, &harness, Pubkey::default()).await,
        DistrictError::Unauthorized,
    );
    assert_eq!(
        read_config(&mut context, &harness).await.pending_admin,
        Pubkey::default()
    );
}

#[tokio::test]
async fn only_the_admin_can_propose() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let result = send(
        &mut context,
        propose_admin_ix(
            &harness,
            harness.impostor.pubkey(),
            harness.impostor.pubkey(),
        ),
        &[&harness.impostor],
    )
    .await;
    expect_error(result, DistrictError::Unauthorized);
    assert_eq!(
        read_config(&mut context, &harness).await.pending_admin,
        Pubkey::default()
    );
}
