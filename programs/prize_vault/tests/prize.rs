//! The prize vault from funding to rollover (D-0101).

mod harness;

use harness::*;
use prize_vault::errors::PrizeError;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

fn prizes(world: &World, amounts: &[u64]) -> Vec<Prize> {
    amounts
        .iter()
        .enumerate()
        .map(|(index, amount)| Prize {
            winner: world.winners[index].pubkey(),
            amount: *amount,
        })
        .collect()
}

// --- initialize -------------------------------------------------------------

#[tokio::test]
async fn the_upgrade_authority_opens_the_vault() {
    let mut world = start().await;
    world.initialize().await.expect("initialize");
    let config = world.config().await;
    assert_eq!(config.authority, world.authority.pubkey());
    assert_eq!(config.pending_authority, Pubkey::default());
    assert_eq!(config.reserved_lamports, 0);
    let vault = world.account(&vault_key()).await.expect("vault exists");
    assert_eq!(vault.owner, prize_vault::ID);
    assert_eq!(vault.lamports, vault_rent());
}

#[tokio::test]
async fn nobody_else_can_open_the_vault() {
    let mut world = start().await;
    let stranger = world.stranger.insecure_clone();
    let ix = world.initialize_ix(&stranger.pubkey());
    expect_error(
        world.send(&[ix], &[&stranger]).await,
        PrizeError::Unauthorized,
    );
}

// --- fund_season ------------------------------------------------------------

#[tokio::test]
async fn funding_sets_sol_aside_only_from_what_the_vault_holds() {
    let mut world = opened(10 * SOL).await;
    let ends = world.now().await + 3_600;

    expect_error(
        world.fund(1, 10 * SOL + 1, ends).await,
        PrizeError::NotEnoughUnallocated,
    );
    world.fund(1, 6 * SOL, ends).await.expect("fund season 1");
    // The 6 SOL are taken; only 4 are left for another season.
    expect_error(
        world.fund(2, 5 * SOL, ends).await,
        PrizeError::NotEnoughUnallocated,
    );
    world.fund(2, 4 * SOL, ends).await.expect("fund season 2");

    assert_eq!(world.config().await.reserved_lamports, 10 * SOL);
    let season = world.season(1).await;
    assert_eq!(
        (season.season_id, season.funded_lamports, season.ends_at),
        (1, 6 * SOL, ends)
    );
    assert!(!season.leftover_released && season.finalized_at == 0);
}

#[tokio::test]
async fn a_running_season_can_be_topped_up_but_keeps_its_end() {
    let mut world = opened(10 * SOL).await;
    let ends = world.now().await + 3_600;
    world.fund(1, 2 * SOL, ends).await.expect("open");
    world.fund(1, 3 * SOL, ends).await.expect("top up");
    assert_eq!(world.season(1).await.funded_lamports, 5 * SOL);

    expect_error(
        world.fund(1, SOL, ends + 60).await,
        PrizeError::SeasonEndChanged,
    );
    world.set_time(ends).await;
    expect_error(world.fund(1, SOL, ends).await, PrizeError::SeasonEnded);
}

#[tokio::test]
async fn funding_is_refused_when_it_makes_no_sense_or_comes_from_someone_else() {
    let mut world = opened(10 * SOL).await;
    let now = world.now().await;
    expect_error(world.fund(1, SOL, now).await, PrizeError::InvalidSeasonEnd);
    expect_error(world.fund(1, 0, now + 60).await, PrizeError::InvalidAmount);

    let stranger = world.stranger.insecure_clone();
    let ix = world.fund_ix(&stranger.pubkey(), 1, SOL, now + 60);
    expect_error(
        world.send(&[ix], &[&stranger]).await,
        PrizeError::Unauthorized,
    );
}

// --- finalize_winners -------------------------------------------------------

#[tokio::test]
async fn winners_are_published_after_the_season_with_a_dispute_window() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 10 * SOL, start + 1_000).await.expect("fund");
    let published = Published::new(1, prizes(&world, &[3 * SOL, 2 * SOL]));

    expect_error(world.finalize(&published).await, PrizeError::SeasonNotEnded);
    world.set_time(start + 1_000).await;
    world.finalize(&published).await.expect("finalize");

    let season = world.season(1).await;
    assert_eq!(season.winners_root, published.root);
    assert_eq!((season.winners, season.prizes_lamports), (2, 5 * SOL));
    assert_eq!(season.claims_open_at, start + 1_000 + DISPUTE_SECONDS);
}

#[tokio::test]
async fn a_list_can_be_corrected_during_the_dispute_window_only() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 10 * SOL, start + 1_000).await.expect("fund");
    world.set_time(start + 1_000).await;
    world
        .finalize(&Published::new(1, prizes(&world, &[3 * SOL])))
        .await
        .expect("first list");

    let correction = start + 1_000 + DISPUTE_SECONDS / 2;
    world.set_time(correction).await;
    let corrected = Published::new(1, prizes(&world, &[2 * SOL, SOL]));
    world.finalize(&corrected).await.expect("corrected list");
    let season = world.season(1).await;
    assert_eq!(season.winners_root, corrected.root);
    // The window starts again from the correction.
    assert_eq!(season.claims_open_at, correction + DISPUTE_SECONDS);

    world.set_time(season.claims_open_at).await;
    expect_error(
        world.finalize(&corrected).await,
        PrizeError::ClaimsAlreadyOpen,
    );
}

#[tokio::test]
async fn a_published_list_must_fit_the_season() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 4 * SOL, start + 1_000).await.expect("fund");
    world.set_time(start + 1_000).await;
    let authority = world.authority.insecure_clone();
    let key = authority.pubkey();

    for (winners, prizes, error) in [
        (0, SOL, PrizeError::InvalidWinnerCount),
        (36, SOL, PrizeError::InvalidWinnerCount),
        (3, 0, PrizeError::InvalidWinnerCount),
        (3, 4 * SOL + 1, PrizeError::PrizesOverFunding),
    ] {
        let ix = world.finalize_ix(&key, 1, [7; 32], winners, prizes);
        expect_error(world.send(&[ix], &[&authority]).await, error);
    }

    let stranger = world.stranger.insecure_clone();
    let ix = world.finalize_ix(&stranger.pubkey(), 1, [7; 32], 1, SOL);
    expect_error(
        world.send(&[ix], &[&stranger]).await,
        PrizeError::Unauthorized,
    );
}

// --- claim ------------------------------------------------------------------

#[tokio::test]
async fn each_winner_claims_their_own_prize() {
    let mut world = opened(10 * SOL).await;
    let amounts = [2 * SOL, SOL + 250_000_000, 750_000_000];
    let published = world.claimable(1, 10 * SOL, prizes(&world, &amounts)).await;

    for (index, amount) in amounts.iter().enumerate() {
        let winner = world.winner(index);
        let before = world.balance(&winner.pubkey()).await;
        world
            .claim(&published, index, &winner)
            .await
            .expect("claim");
        // The context payer pays the fee, so the winner gets exactly the prize.
        assert_eq!(world.balance(&winner.pubkey()).await, before + amount);
    }

    let season = world.season(1).await;
    assert_eq!(season.claimed_lamports, published.total());
    assert_eq!(season.claimed_bitmap, 0b111);
    let config = world.config().await;
    assert_eq!(config.paid_lamports, published.total());
    assert_eq!(config.reserved_lamports, 10 * SOL - published.total());
    assert_eq!(
        world.balance(&vault_key()).await,
        vault_rent() + 10 * SOL - published.total()
    );
}

#[tokio::test]
async fn a_prize_is_paid_once() {
    let mut world = opened(10 * SOL).await;
    let published = world
        .claimable(1, 10 * SOL, prizes(&world, &[SOL, SOL]))
        .await;
    let winner = world.winner(0);
    world
        .claim(&published, 0, &winner)
        .await
        .expect("first claim");
    expect_error(
        world.claim(&published, 0, &winner).await,
        PrizeError::AlreadyClaimed,
    );
}

#[tokio::test]
async fn claims_wait_for_the_dispute_window() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 10 * SOL, start + 1_000).await.expect("fund");
    let published = Published::new(1, prizes(&world, &[SOL]));
    let winner = world.winner(0);

    world.set_time(start + 1_000).await;
    expect_error(
        world.claim(&published, 0, &winner).await,
        PrizeError::NotFinalized,
    );
    world.finalize(&published).await.expect("finalize");
    world.set_time(start + 1_000 + DISPUTE_SECONDS - 1).await;
    expect_error(
        world.claim(&published, 0, &winner).await,
        PrizeError::ClaimsNotOpen,
    );
    world.set_time(start + 1_000 + DISPUTE_SECONDS).await;
    world
        .claim(&published, 0, &winner)
        .await
        .expect("claim once open");
}

#[tokio::test]
async fn nobody_claims_with_a_proof_that_is_not_theirs() {
    let mut world = opened(10 * SOL).await;
    let published = world
        .claimable(1, 10 * SOL, prizes(&world, &[2 * SOL, SOL]))
        .await;
    let stranger = world.stranger.insecure_clone();
    let winner = world.winner(0);

    // Someone else signing with winner 0's row and proof.
    expect_error(
        world.claim(&published, 0, &stranger).await,
        PrizeError::InvalidProof,
    );
    // The winner asking for more than the list says.
    let ix = world.claim_ix(&winner.pubkey(), 1, 0, 2 * SOL + 1, published.proof(0));
    expect_error(
        world.send(&[ix], &[&winner]).await,
        PrizeError::InvalidProof,
    );
    // Another row's index with this winner's proof.
    let ix = world.claim_ix(&winner.pubkey(), 1, 1, 2 * SOL, published.proof(0));
    expect_error(
        world.send(&[ix], &[&winner]).await,
        PrizeError::InvalidProof,
    );
    // An index past the list.
    let ix = world.claim_ix(&winner.pubkey(), 1, 2, SOL, published.proof(0));
    expect_error(
        world.send(&[ix], &[&winner]).await,
        PrizeError::InvalidIndex,
    );
    // A proof padded far past what 35 winners need.
    let ix = world.claim_ix(&winner.pubkey(), 1, 0, 2 * SOL, vec![[0; 32]; 9]);
    expect_error(
        world.send(&[ix], &[&winner]).await,
        PrizeError::ProofTooLong,
    );

    world
        .claim(&published, 0, &winner)
        .await
        .expect("the real claim still works");
}

#[tokio::test]
async fn no_single_prize_exceeds_the_largest_pool() {
    let mut world = opened(10 * SOL).await;
    // 30% of 10 SOL is the most one winner may take.
    let published = world
        .claimable(1, 10 * SOL, prizes(&world, &[3 * SOL + 1, SOL]))
        .await;
    let winner = world.winner(0);
    expect_error(
        world.claim(&published, 0, &winner).await,
        PrizeError::PrizeTooLarge,
    );
    let second = world.winner(1);
    world
        .claim(&published, 1, &second)
        .await
        .expect("a prize under the cap");
}

#[tokio::test]
async fn claims_never_pay_more_than_the_published_total() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 10 * SOL, start + 1_000).await.expect("fund");
    world.set_time(start + 1_000).await;
    // A list whose rows add up to 3 SOL, published as 2.5 SOL.
    let published = Published::new(1, prizes(&world, &[2 * SOL, SOL]));
    let authority = world.authority.insecure_clone();
    let ix = world.finalize_ix(&authority.pubkey(), 1, published.root, 2, 2_500_000_000);
    world.send(&[ix], &[&authority]).await.expect("finalize");
    world.set_time(start + 1_000 + DISPUTE_SECONDS).await;

    let first = world.winner(0);
    world
        .claim(&published, 0, &first)
        .await
        .expect("first claim fits");
    let second = world.winner(1);
    expect_error(
        world.claim(&published, 1, &second).await,
        PrizeError::ClaimsOverPrizes,
    );
}

#[tokio::test]
async fn a_prize_waits_for_its_winner_with_no_deadline() {
    let mut world = opened(10 * SOL).await;
    let published = world.claimable(1, 10 * SOL, prizes(&world, &[SOL])).await;
    let later = world.now().await + DECADE_SECONDS;
    world.set_time(later).await;
    let winner = world.winner(0);
    let before = world.balance(&winner.pubkey()).await;
    world
        .claim(&published, 0, &winner)
        .await
        .expect("a claim ten years later");
    assert_eq!(world.balance(&winner.pubkey()).await, before + SOL);
}

// --- rollover ---------------------------------------------------------------

#[tokio::test]
async fn only_funding_no_winner_holds_rolls_over() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 10 * SOL, start + 1_000).await.expect("fund");
    world.set_time(start + 1_000).await;
    let published = Published::new(1, prizes(&world, &[3 * SOL, 2 * SOL]));
    world.finalize(&published).await.expect("finalize");

    let stranger = world.stranger.insecure_clone();
    expect_error(
        world.rollover(1, &stranger).await,
        PrizeError::RolloverNotReady,
    );
    world.set_time(start + 1_000 + DISPUTE_SECONDS).await;
    let winner = world.winner(0);
    world
        .claim(&published, 0, &winner)
        .await
        .expect("one winner claims");

    world
        .rollover(1, &stranger)
        .await
        .expect("anyone rolls the leftover over once claims open");
    assert!(world.season(1).await.leftover_released);
    // 10 SOL funded, 5 in prizes: 5 are free again. The 2 SOL prize still
    // waiting for its winner stays reserved; all of it is still in the vault.
    assert_eq!(world.config().await.reserved_lamports, 2 * SOL);
    assert_eq!(world.balance(&vault_key()).await, vault_rent() + 7 * SOL);
    expect_error(
        world.rollover(1, &stranger).await,
        PrizeError::AlreadyRolledOver,
    );

    let now = world.now().await;
    expect_error(
        world.fund(2, 5 * SOL + 1, now + 60).await,
        PrizeError::NotEnoughUnallocated,
    );
    world
        .fund(2, 5 * SOL, now + 60)
        .await
        .expect("the next season gets the leftover, not the prize");

    // Years on, the second winner still finds their prize.
    world.set_time(now + DECADE_SECONDS).await;
    let second = world.winner(1);
    world
        .claim(&published, 1, &second)
        .await
        .expect("the prize was kept");
    assert_eq!(world.config().await.reserved_lamports, 5 * SOL);
}

#[tokio::test]
async fn a_season_without_winners_is_published_empty_and_rolls_over_whole() {
    let mut world = opened(10 * SOL).await;
    let start = world.now().await;
    world.fund(1, 4 * SOL, start + 60).await.expect("fund");
    world.set_time(start + 60).await;
    let authority = world.authority.insecure_clone();
    let ix = world.finalize_ix(&authority.pubkey(), 1, [0; 32], 0, 0);
    world
        .send(&[ix], &[&authority])
        .await
        .expect("publish no winners");
    world.set_time(start + 60 + DISPUTE_SECONDS).await;
    let stranger = world.stranger.insecure_clone();
    world.rollover(1, &stranger).await.expect("rollover");
    assert_eq!(world.config().await.reserved_lamports, 0);
    let winner = world.winner(0);
    let ix = world.claim_ix(&winner.pubkey(), 1, 0, SOL, vec![]);
    expect_error(
        world.send(&[ix], &[&winner]).await,
        PrizeError::InvalidIndex,
    );
}

#[tokio::test]
async fn a_season_without_published_winners_does_not_roll_over() {
    let mut world = opened(10 * SOL).await;
    let now = world.now().await;
    world.fund(1, SOL, now + 60).await.expect("fund");
    world.set_time(now + DECADE_SECONDS).await;
    let stranger = world.stranger.insecure_clone();
    expect_error(
        world.rollover(1, &stranger).await,
        PrizeError::RolloverNotReady,
    );
}

// --- authority --------------------------------------------------------------

#[tokio::test]
async fn the_authority_moves_only_when_the_new_one_accepts() {
    let mut world = opened(10 * SOL).await;
    let old = world.authority.insecure_clone();
    let next = Keypair::new();
    let stranger = world.stranger.insecure_clone();

    let ix = world.accept_ix(&next.pubkey());
    expect_error(
        world.send(&[ix], &[&next]).await,
        PrizeError::NoPendingAuthority,
    );
    let ix = world.propose_ix(&stranger.pubkey(), stranger.pubkey());
    expect_error(
        world.send(&[ix], &[&stranger]).await,
        PrizeError::Unauthorized,
    );

    let ix = world.propose_ix(&old.pubkey(), next.pubkey());
    world.send(&[ix], &[&old]).await.expect("propose");
    let ix = world.accept_ix(&stranger.pubkey());
    expect_error(
        world.send(&[ix], &[&stranger]).await,
        PrizeError::Unauthorized,
    );
    let ix = world.accept_ix(&next.pubkey());
    world.send(&[ix], &[&next]).await.expect("accept");

    let config = world.config().await;
    assert_eq!(
        (config.authority, config.pending_authority),
        (next.pubkey(), Pubkey::default())
    );
    let now = world.now().await;
    expect_error(world.fund(1, SOL, now + 60).await, PrizeError::Unauthorized);
    // The authority pays the season account's rent, so it needs some SOL.
    let payer = world.context.payer.pubkey();
    let rent = solana_sdk::system_instruction::transfer(&payer, &next.pubkey(), SOL);
    world
        .send(&[rent], &[])
        .await
        .expect("fund the new authority");
    let ix = world.fund_ix(&next.pubkey(), 1, SOL, now + 60);
    world
        .send(&[ix], &[&next])
        .await
        .expect("the new authority funds");
}
