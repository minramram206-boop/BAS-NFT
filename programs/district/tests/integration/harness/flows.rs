//! Multi-step setups that most tests start from.

use anchor_lang::solana_program::pubkey::Pubkey;
use district::{roles::CitizenRole, state::CitizenStat, MissionClaimArgs};
use solana_program_test::ProgramTestContext;
use solana_sdk::signer::Signer;

use super::bank::{send, Harness, SendResult};
use super::fixtures::{install_member_with_uri, mint_account, token_account, TokenFlavor};
use super::ix::*;
use super::{member_uri, AN_HOUR, NOW, TOKEN_SUPPLY};

pub async fn initialize(context: &mut ProgramTestContext, harness: &Harness) {
    send(
        context,
        initialize_config_ix(harness, harness.admin.pubkey(), default_init_args(harness)),
        &[&harness.admin],
    )
    .await
    .expect("initialize_config must succeed for the upgrade authority");
}

/// Installs the harness utility mint for `flavor` and binds it.
pub async fn bind_utility_mint(
    context: &mut ProgramTestContext,
    harness: &Harness,
    flavor: TokenFlavor,
) {
    let authority = context.payer.pubkey();
    context.set_account(
        &harness.utility_mint.pubkey(),
        &mint_account(flavor, &authority, TOKEN_SUPPLY),
    );
    send(
        context,
        set_utility_mint_ix(
            harness,
            harness.admin.pubkey(),
            harness.utility_mint.pubkey(),
        ),
        &[&harness.admin],
    )
    .await
    .expect("binding an initialized mint must succeed");
}

pub async fn lock_and_unpause(context: &mut ProgramTestContext, harness: &Harness) {
    send(
        context,
        lock_utility_mint_ix(harness, harness.admin.pubkey()),
        &[&harness.admin],
    )
    .await
    .expect("locking a bound mint must succeed");
    send(
        context,
        set_paused_ix(harness, harness.admin.pubkey(), false),
        &[&harness.admin],
    )
    .await
    .expect("unpausing after the lock must succeed");
}

/// A live district on SPL Token: initialized, mint bound and locked, unpaused.
pub async fn bootstrap(context: &mut ProgramTestContext, harness: &Harness) {
    bootstrap_with(context, harness, TokenFlavor::Spl).await;
}

pub async fn bootstrap_with(
    context: &mut ProgramTestContext,
    harness: &Harness,
    flavor: TokenFlavor,
) {
    initialize(context, harness).await;
    bind_utility_mint(context, harness, flavor).await;
    lock_and_unpause(context, harness).await;
}

pub async fn register_member(
    context: &mut ProgramTestContext,
    harness: &Harness,
) -> (Pubkey, Pubkey) {
    register_role(context, harness, CitizenRole::Pioneer).await
}

pub async fn register_role(
    context: &mut ProgramTestContext,
    harness: &Harness,
    role: CitizenRole,
) -> (Pubkey, Pubkey) {
    let asset = install_member_with_uri(context, harness, &member_uri(role));
    send(
        context,
        register_ix(harness, asset, harness.holder.pubkey()),
        &[&harness.holder],
    )
    .await
    .expect("registering a genuine collection member must succeed");
    (asset, harness.citizen_pda(&asset))
}

pub fn claim_args(stat: CitizenStat, mission_id: u64, nonce: u64) -> MissionClaimArgs {
    MissionClaimArgs {
        stat: stat as u8,
        mission_id,
        season_id: 1,
        nonce,
        expires_at: NOW + AN_HOUR,
    }
}

/// Sends an honest claim for the holder, co-signed by the mission authority.
pub async fn send_claim(
    context: &mut ProgramTestContext,
    harness: &Harness,
    asset: Pubkey,
    args: MissionClaimArgs,
) -> SendResult {
    let accounts = ClaimAccounts::for_holder(harness, asset, &args);
    send(
        context,
        claim_ix(harness, &accounts, args),
        &[&harness.holder, &harness.mission_authority],
    )
    .await
}

/// Earns one credit through the real instruction, never by writing state.
pub async fn claim_credit(
    context: &mut ProgramTestContext,
    harness: &Harness,
    asset: Pubkey,
    stat: CitizenStat,
    mission_id: u64,
) {
    let nonce = mission_id * 1_000 + u64::from(stat as u8);
    send_claim(context, harness, asset, claim_args(stat, mission_id, nonce))
        .await
        .expect("an authorized, unexpired claim must succeed");
}

/// A registered citizen plus a holder token account with `balance` atoms.
pub struct Training {
    pub accounts: UpgradeAccounts,
}

impl Training {
    pub fn asset(&self) -> Pubkey {
        self.accounts.asset
    }

    pub fn citizen_state(&self) -> Pubkey {
        self.accounts.citizen_state
    }

    pub fn user_token_account(&self) -> Pubkey {
        self.accounts.user_token_account
    }
}

pub async fn setup_training(
    context: &mut ProgramTestContext,
    harness: &Harness,
    balance: u64,
) -> Training {
    setup_training_with(context, harness, balance, TokenFlavor::Spl).await
}

pub async fn setup_training_with(
    context: &mut ProgramTestContext,
    harness: &Harness,
    balance: u64,
    flavor: TokenFlavor,
) -> Training {
    let (asset, citizen_state) = register_member(context, harness).await;
    let user_token_account = Pubkey::new_unique();
    context.set_account(
        &user_token_account,
        &token_account(
            flavor,
            &harness.utility_mint.pubkey(),
            &harness.holder.pubkey(),
            balance,
        ),
    );
    Training {
        accounts: UpgradeAccounts {
            asset,
            citizen_state,
            owner: harness.holder.pubkey(),
            utility_mint: harness.utility_mint.pubkey(),
            user_token_account,
            token_program: flavor.program_id(),
        },
    }
}

pub async fn upgrade(
    context: &mut ProgramTestContext,
    harness: &Harness,
    setup: &Training,
    stat: CitizenStat,
) -> SendResult {
    send(
        context,
        upgrade_ix(harness, &setup.accounts, stat as u8),
        &[&harness.holder],
    )
    .await
}
