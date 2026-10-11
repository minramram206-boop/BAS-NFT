//! Accounts written straight into the bank, and readers for program state.

use anchor_lang::{
    solana_program::{bpf_loader_upgradeable, program_pack::Pack, pubkey::Pubkey},
    AccountDeserialize, AccountSerialize,
};
use anchor_spl::{token, token_2022};
use district::{
    constants::CITIZEN_STATE_VERSION,
    mpl_core::{self, MPL_CORE_PROGRAM_ID},
    roles::CitizenRole,
    state::{ApprovedTemplate, CitizenState, ClaimReceipt, DistrictConfig},
};
use solana_program_test::ProgramTestContext;
use solana_sdk::{account::Account, account::AccountSharedData, rent::Rent, signer::Signer};
use spl_token::state::{Account as TokenAccountState, AccountState, Mint as MintState};

use super::bank::Harness;
use super::{MEMBER_URI, TOKEN_DECIMALS};

/// Which token program a fixture mint or token account belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenFlavor {
    Spl,
    Token2022,
}

impl TokenFlavor {
    pub fn program_id(self) -> Pubkey {
        match self {
            Self::Spl => token::ID,
            Self::Token2022 => token_2022::ID,
        }
    }
}

pub fn install_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    data: Vec<u8>,
    owner: Pubkey,
) {
    let lamports = Rent::default().minimum_balance(data.len().max(1));
    context.set_account(
        &address,
        &AccountSharedData::from(Account {
            lamports,
            data,
            owner,
            executable: false,
            rent_epoch: u64::MAX,
        }),
    );
}

/// The upgradeable loader's ProgramData for this program, bincode encoded:
/// variant tag 3, slot, then `Option<Pubkey>` for the upgrade authority.
pub fn install_program_data(
    context: &mut ProgramTestContext,
    harness: &Harness,
    authority: Option<Pubkey>,
) {
    let mut data = 3u32.to_le_bytes().to_vec();
    data.extend_from_slice(&0u64.to_le_bytes());
    match authority {
        Some(key) => {
            data.push(1);
            data.extend_from_slice(key.as_ref());
        }
        None => data.push(0),
    }
    install_account(
        context,
        harness.program_data_key(),
        data,
        bpf_loader_upgradeable::ID,
    );
}

// --- Metaplex Core assets --------------------------------------------------

pub fn core_asset(owner: &Pubkey, collection: &Pubkey) -> Vec<u8> {
    core_asset_with_uri(owner, collection, MEMBER_URI)
}

pub fn core_asset_with_uri(owner: &Pubkey, collection: &Pubkey, uri: &str) -> Vec<u8> {
    let mut data = vec![mpl_core::KEY_ASSET_V1];
    data.extend_from_slice(owner.as_ref());
    data.push(mpl_core::UPDATE_AUTHORITY_COLLECTION);
    data.extend_from_slice(collection.as_ref());
    for text in ["Citizen #13", uri] {
        data.extend_from_slice(&(text.len() as u32).to_le_bytes());
        data.extend_from_slice(text.as_bytes());
    }
    data.push(1); // seq: Some(1)
    data.extend_from_slice(&1u64.to_le_bytes());
    data
}

/// An account owned by the real Metaplex Core program id.
pub fn install_asset(context: &mut ProgramTestContext, asset: Pubkey, data: Vec<u8>) {
    install_account(context, asset, data, MPL_CORE_PROGRAM_ID);
}

pub fn install_member(context: &mut ProgramTestContext, harness: &Harness) -> Pubkey {
    install_member_with_uri(context, harness, MEMBER_URI)
}

/// A collection member held by `harness.holder` whose metadata file is `uri`.
pub fn install_member_with_uri(
    context: &mut ProgramTestContext,
    harness: &Harness,
    uri: &str,
) -> Pubkey {
    let asset = Pubkey::new_unique();
    install_asset(
        context,
        asset,
        core_asset_with_uri(&harness.holder.pubkey(), &harness.collection_mint, uri),
    );
    asset
}

// --- token accounts ----------------------------------------------------------

pub fn mint_account(flavor: TokenFlavor, authority: &Pubkey, supply: u64) -> AccountSharedData {
    mint_account_with_decimals(flavor, authority, supply, TOKEN_DECIMALS)
}

pub fn mint_account_with_decimals(
    flavor: TokenFlavor,
    authority: &Pubkey,
    supply: u64,
    decimals: u8,
) -> AccountSharedData {
    let mut data = vec![0u8; MintState::LEN];
    MintState {
        mint_authority: Some(*authority).into(),
        supply,
        decimals,
        is_initialized: true,
        freeze_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    owned_by(flavor.program_id(), data)
}

/// Token-2022 accounts without extensions share the SPL Token layout.
pub fn token_account(
    flavor: TokenFlavor,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> AccountSharedData {
    let mut data = vec![0u8; TokenAccountState::LEN];
    TokenAccountState {
        mint: *mint,
        owner: *owner,
        amount,
        delegate: None.into(),
        state: AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    owned_by(flavor.program_id(), data)
}

pub fn owned_by(owner: Pubkey, data: Vec<u8>) -> AccountSharedData {
    AccountSharedData::from(Account {
        lamports: 10_000_000_000,
        data,
        owner,
        executable: false,
        rent_epoch: u64::MAX,
    })
}

pub async fn token_balance(context: &mut ProgramTestContext, account: Pubkey) -> u64 {
    TokenAccountState::unpack(&raw_account(context, account).await.data)
        .expect("a token account")
        .amount
}

/// Only drops when tokens are really burned, not transferred.
pub async fn token_supply(context: &mut ProgramTestContext, mint: Pubkey) -> u64 {
    MintState::unpack(&raw_account(context, mint).await.data)
        .expect("a mint")
        .supply
}

// --- program state -------------------------------------------------------------

pub async fn raw_account(context: &mut ProgramTestContext, address: Pubkey) -> Account {
    context
        .banks_client
        .get_account(address)
        .await
        .expect("bank transport")
        .unwrap_or_else(|| panic!("account {address} must exist"))
}

pub async fn account_exists(context: &mut ProgramTestContext, address: Pubkey) -> bool {
    context
        .banks_client
        .get_account(address)
        .await
        .expect("bank transport")
        .is_some()
}

async fn read<T: AccountDeserialize>(context: &mut ProgramTestContext, address: Pubkey) -> T {
    let account = raw_account(context, address).await;
    T::try_deserialize(&mut &account.data[..]).expect("account must deserialize")
}

pub async fn read_config(context: &mut ProgramTestContext, harness: &Harness) -> DistrictConfig {
    read(context, harness.config_key()).await
}

pub async fn read_template(
    context: &mut ProgramTestContext,
    harness: &Harness,
) -> ApprovedTemplate {
    read(context, harness.template_key()).await
}

pub async fn read_citizen(context: &mut ProgramTestContext, citizen_state: Pubkey) -> CitizenState {
    read(context, citizen_state).await
}

pub async fn read_receipt(context: &mut ProgramTestContext, receipt: Pubkey) -> ClaimReceipt {
    read(context, receipt).await
}

fn install_state<T: AccountSerialize>(
    context: &mut ProgramTestContext,
    address: Pubkey,
    value: &T,
) {
    let mut data = Vec::new();
    value
        .try_serialize(&mut data)
        .expect("state must serialize");
    install_account(context, address, data, district::ID);
}

/// Rewrites the config for states no instruction sequence can reach, such as
/// an unpaused district without a bound mint.
pub async fn overwrite_config(
    context: &mut ProgramTestContext,
    harness: &Harness,
    edit: impl FnOnce(&mut DistrictConfig),
) {
    let mut config = read_config(context, harness).await;
    edit(&mut config);
    install_state(context, harness.config_key(), &config);
}

pub fn install_citizen(
    context: &mut ProgramTestContext,
    citizen_state: Pubkey,
    citizen: &CitizenState,
) {
    install_state(context, citizen_state, citizen);
}

pub fn citizen_fixture(asset: Pubkey, role: CitizenRole) -> CitizenState {
    let template = role.template();
    CitizenState {
        version: CITIZEN_STATE_VERSION,
        bump: district::pda::citizen_address(&asset).1,
        citizen_id: 1,
        asset,
        role: template.index,
        intelligence: template.initial_intelligence,
        alignment: template.initial_alignment,
        compute: template.initial_compute,
        insight_training_credits: 0,
        bond_training_credits: 0,
        craft_training_credits: 0,
    }
}
