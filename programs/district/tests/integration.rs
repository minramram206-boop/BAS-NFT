//! End-to-end instruction tests for the district program.
//!
//! These run against `solana-program-test`, which executes the real program
//! logic inside a simulated bank: account constraints, PDA derivation, borsh
//! serialization, the clock sysvar and the CPI to SPL Token all really happen.
//! No validator, no BPF build and no Anchor CLI are involved, so plain
//! `cargo test` covers the instruction path.
//!
//! What this harness cannot see is `emit!`. `solana_runtime`'s log collector is
//! built with `LogCollectorFilter::ExcludeReturnData`, and because the program
//! runs as a native builtin rather than through the BPF VM, the `sol_log_data`
//! call Anchor uses for events is dropped before it reaches the returned logs.
//! So every assertion here reads committed account state — the config PDA, the
//! citizen PDA, claim receipts, token balances and the mint supply — which is
//! what an indexer or a client would end up relying on anyway. The event
//! payloads still need an `anchor test` run against a real validator (D-0012).
//!
//! The processor is the `entry` function that Anchor's `#[program]` macro
//! generates — `pub fn entry(&Pubkey, &[AccountInfo], &[u8]) -> ProgramResult`,
//! exactly the signature `ProgramTest::new` asks for.
//!
//! Scope: the acceptance tests of `PIXEL_DISTRICT_SPEC_V2_ID.md` §15.3 and
//! §15.4 that can be expressed against a simulated bank. Byte-level parsing of
//! the Metaplex Core layout is covered separately by `src/mpl_core.rs`, the
//! economic formula by `src/state.rs`, and the role registry by `src/roles.rs`.
//!
//! Run with `pnpm program:test`, which is also what `[scripts].test` in
//! `programs/Anchor.toml` and the CI `programs` job execute.

use anchor_lang::{
    solana_program::{
        clock::Clock, entrypoint::ProgramResult, instruction::Instruction, program_pack::Pack,
        pubkey::Pubkey, system_instruction::SystemError, system_program,
    },
    // `try_serialize` comes from `AccountSerialize`, the trait Anchor's
    // `#[account]` implements; it writes the 8-byte discriminator followed by
    // the borsh body, which is exactly what `try_deserialize` reads back.
    // `AnchorSerialize` at this path is only the derive macro, not the trait, so
    // importing it does not bring the method into scope.
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token;
use district::{
    accounts, approved_template_address, errors::DistrictError, instruction,
    mpl_core::{self, MPL_CORE_PROGRAM_ID},
    roles::{CitizenRole, ROLE_COUNT, ROLE_TEMPLATES},
    state::{
        ApprovedTemplate, ClaimReceipt, CitizenStat, CitizenState, DistrictConfig,
        APPROVED_TEMPLATE_VERSION, CITIZEN_STATE_VERSION, DISTRICT_CONFIG_VERSION, STAT_MAX,
        TIER_1_SCORE, TIER_2_SCORE, TIER_3_SCORE,
    },
    InitializeConfigArgs, MissionClaimArgs, UpdateConfigArgs,
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    // `AccountInfo` is re-exported by solana_sdk from the same solana-program
    // 1.18.26 that anchor_lang is pinned to, so this is the very type the
    // processor shim hands to `district::entry`.
    account::AccountSharedData, account_info::AccountInfo, instruction::InstructionError,
    rent::Rent, signature::Keypair, signer::Signer, transaction::Transaction,
    transaction::TransactionError, transport::TransportError,
};
use spl_token::state::{Account as SplTokenAccount, AccountState, Mint as SplMint};

/// `base_training_cost` in token atoms (§5.3). With this value the spec's own
/// examples hold: a score of 0 costs 100 to raise, a score of 8 costs 900.
const BASE_TRAINING_COST: u64 = 100;

/// Template identifier the district approves (§6.3 item 3).
const APPROVED_TEMPLATE_ID: u32 = 7;
/// Immutable URI prefix stored in the approved-template PDA.
const APPROVED_TEMPLATE_URI_PREFIX: &str =
    "https://metadata.example.invalid/templates/7/";

const TOKEN_DECIMALS: u8 = 9;
const TOKEN_SUPPLY: u64 = 1_000_000_000;

/// A fixed clock so `expires_at` comparisons are deterministic.
const NOW: i64 = 1_700_000_000;
const AN_HOUR: i64 = 3_600;

/// Ok when the transaction committed, or the transport error it failed with.
type SendResult = Result<(), TransportError>;

// ---------------------------------------------------------------------------
// harness
//
// Keys and addresses live in `Harness`, which is never borrowed mutably, while
// the bank lives in `ProgramTestContext`. Splitting them keeps every helper
// `(&mut ProgramTestContext, &Harness)` and avoids borrowing one struct both
// ways in a single call.
// ---------------------------------------------------------------------------

struct Harness {
    /// Bootstrap authority, and admin after `initialize_config`.
    admin: Keypair,
    /// Signs authorized mission claims (§12 `claim_training_credit`).
    mission_authority: Keypair,
    /// Owns the citizens these tests register.
    holder: Keypair,
    /// Owns nothing, signs nothing it should not.
    impostor: Keypair,
    /// Successor admin for the two-step transfer.
    successor: Keypair,
    /// The official utility token. A keypair so the fixture can be installed at
    /// a known address before `set_utility_mint` binds it.
    utility_mint: Keypair,
    config: Pubkey,
    collection_mint: Pubkey,
    /// Stand-in for the Metaplex Core program. The district program only ever
    /// compares `asset.owner` against the account passed as `mpl_core_program`,
    /// so this address does not have to be executable for the ownership
    /// constraint to be meaningful.
    mpl_core: Pubkey,
    sol_treasury: Pubkey,
    /// Next slot `advance` will warp to. A cell so `Harness` stays shareable as
    /// `&Harness` while the bank is `&mut ProgramTestContext`.
    next_warp_slot: std::cell::Cell<u64>,
}

impl Harness {
    fn config_key(&self) -> Pubkey {
        self.config
    }

    fn collection_key(&self) -> Pubkey {
        self.collection_mint
    }

    fn mpl_core_key(&self) -> Pubkey {
        self.mpl_core
    }

    fn admin_key(&self) -> Pubkey {
        self.admin.pubkey()
    }

    fn mission_authority_key(&self) -> Pubkey {
        self.mission_authority.pubkey()
    }

    fn holder_key(&self) -> Pubkey {
        self.holder.pubkey()
    }

    fn impostor_key(&self) -> Pubkey {
        self.impostor.pubkey()
    }

    fn successor_key(&self) -> Pubkey {
        self.successor.pubkey()
    }

    fn utility_mint_key(&self) -> Pubkey {
        self.utility_mint.pubkey()
    }

    /// Immutable URI registry PDA for the approved template (§6.3 item 3).
    fn template_key(&self) -> Pubkey {
        approved_template_address(APPROVED_TEMPLATE_ID)
    }

    /// §6.4: seed `["citizen", asset]`.
    fn citizen_pda(&self, asset: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"citizen", asset.as_ref()], &district::ID)
    }

    /// The single-use receipt for one mission claim.
    fn claim_receipt_pda(&self, asset: &Pubkey, mission_id: u64, nonce: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                b"claim",
                asset.as_ref(),
                &mission_id.to_le_bytes(),
                &nonce.to_le_bytes(),
            ],
            &district::ID,
        )
    }
}

/// Adapter between Anchor's `entry` and what `ProgramTest` asks for.
///
/// `invoke_builtin_function` takes a `ProcessInstruction`, whose higher-ranked
/// type is `for<'a, 'b, 'c, 'd> fn(&'a Pubkey, &'b [AccountInfo<'c>], &'d [u8])`.
/// Anchor's generated `entry` is `for<'a, 'b, 'info> fn(&'a Pubkey,
/// &'info [AccountInfo<'info>], &'b [u8])`: one lifetime appears twice.
/// `AccountInfo<'x>` holds `Rc<RefCell<&'x mut u64>>`, so it is invariant in
/// `'x` and the compiler cannot make the found type more general. Bridging the
/// lifetimes is the standard workaround; it is sound here because the bank
/// builds every `AccountInfo` for one instruction and drops them all before
/// returning.
fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    district::entry(program_id, unsafe { std::mem::transmute(accounts) }, data)
}

async fn start() -> (ProgramTestContext, Harness) {
    let mut program_test = ProgramTest::new("district", district::ID, processor!(process_instruction));
    // Registration writes a PDA and reads a Core asset; give it headroom so
    // tests fail on logic rather than on the default 200k per-instruction
    // budget. Not a substitute for measuring the real BPF cost.
    program_test.set_compute_max_units(1_400_000);
    let mut context = program_test.start_with_context().await;

    // `claim_training_credit` compares `expires_at` against the clock, so the
    // clock has to be a known value rather than the bank's default.
    context.set_sysvar(&Clock {
        slot: 1,
        epoch_start_timestamp: NOW,
        epoch: 1,
        leader_schedule_epoch: 2,
        unix_timestamp: NOW,
    });

    let harness = Harness {
        admin: Keypair::new(),
        mission_authority: Keypair::new(),
        holder: Keypair::new(),
        impostor: Keypair::new(),
        successor: Keypair::new(),
        utility_mint: Keypair::new(),
        config: Pubkey::find_program_address(&[b"district_config"], &district::ID).0,
        collection_mint: Pubkey::new_unique(),
        mpl_core: MPL_CORE_PROGRAM_ID,
        sol_treasury: Pubkey::new_unique(),
        next_warp_slot: std::cell::Cell::new(2),
    };

    // Anchor's `init` constraint funds the new account from the account named
    // as `payer`, not from the transaction fee payer. `InitializeConfig`
    // declares `payer = admin`, `RegisterCitizen` and `ClaimTrainingCredit`
    // declare `payer = owner`, so those keypairs need their own rent balance or
    // the system program CPI fails with `insufficient lamports 0, need ...`.
    for account in [
        harness.admin_key(),
        harness.holder_key(),
        harness.impostor_key(),
        harness.successor_key(),
    ] {
        context.set_account(
            &account,
            &AccountSharedData::new(10_000_000_000, 0, &system_program::ID),
        );
    }

    (context, harness)
}

/// Send one instruction.
///
/// `Transaction::new_signed_with_payer` puts the payer in the message's signer
/// positions but then calls `sign(keypairs, ..)` with exactly the keypairs it is
/// given, so the payer has to be in that list or signing fails with
/// `KeypairPubkeyMismatch`. Passing the same keypair twice is explicitly allowed
/// and gets deduplicated, so extra signers are simply appended.
async fn send(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    signers: &[&Keypair],
) -> SendResult {
    let mut message_signers: Vec<&Keypair> = Vec::with_capacity(signers.len() + 1);
    message_signers.push(&context.payer);
    for signer in signers {
        if signer.pubkey() != context.payer.pubkey() {
            message_signers.push(signer);
        }
    }

    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &message_signers,
        context.last_blockhash,
    );

    let executed = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await?;

    match executed.result {
        Ok(()) => Ok(()),
        Err(transaction_error) => Err(TransportError::TransactionError(transaction_error)),
    }
}

/// Move the bank to a fresh blockhash.
///
/// A transaction's signature is a hash of its message, and the message is built
/// from the payer, the instruction and the blockhash. Repeating a byte-identical
/// instruction inside one test therefore produces an identical signature, which
/// the bank rejects as `AlreadyProcessed` without ever invoking the program — so
/// any test that sends the same thing twice has to call this in between, or it
/// passes (or fails) for the wrong reason.
async fn advance(context: &mut ProgramTestContext, harness: &Harness) {
    // `warp_to_slot` only moves forward, and `ProgramTestContext` exposes no way
    // to read the current slot, so the harness keeps the next one itself.
    let slot = harness.next_warp_slot.get();
    harness.next_warp_slot.set(slot + 1_000);
    context.warp_to_slot(slot).expect("warping a slot");
    context.last_blockhash = context
        .get_new_latest_blockhash()
        .await
        .expect("a fresh blockhash");
}

/// The Anchor error code of a transaction that was supposed to fail.
///
/// `#[error_code]` generates `impl From<Enum> for u32` as `variant as u32 +
/// ERROR_CODE_OFFSET`, so the expected code has to go through that conversion
/// rather than being cast by hand.
fn expect_error_code(result: SendResult, expected: DistrictError) -> u32 {
    let failure = result.expect_err("the instruction was supposed to fail");
    let code = custom_error_code(&failure);
    assert_eq!(
        code,
        u32::from(expected),
        "expected {:?} ({}) but the program returned {code}",
        expected,
        u32::from(expected)
    );
    code
}

fn custom_error_code(failure: &TransportError) -> u32 {
    match failure {
        TransportError::TransactionError(TransactionError::InstructionError(_, instruction_error)) => {
            match instruction_error {
                InstructionError::Custom(code) => *code,
                other => panic!("expected a custom program error, got {other:?}"),
            }
        }
        other => panic!("expected an instruction error, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// account fixtures
// ---------------------------------------------------------------------------

async fn read_config(context: &mut ProgramTestContext, harness: &Harness) -> DistrictConfig {
    let account = context
        .banks_client
        .get_account(harness.config_key())
        .await
        .expect("a transport error")
        .expect("the district config must exist");
    DistrictConfig::try_deserialize(&mut &account.data[..]).expect("the config must deserialize")
}

async fn read_approved_template(
    context: &mut ProgramTestContext,
    harness: &Harness,
) -> ApprovedTemplate {
    let account = context
        .banks_client
        .get_account(harness.template_key())
        .await
        .expect("a transport error")
        .expect("the approved-template registry must exist");
    ApprovedTemplate::try_deserialize(&mut &account.data[..])
        .expect("the approved-template registry must deserialize")
}

async fn read_citizen(context: &mut ProgramTestContext, citizen_state: Pubkey) -> CitizenState {
    let account = context
        .banks_client
        .get_account(citizen_state)
        .await
        .expect("a transport error")
        .expect("the citizen state must exist");
    CitizenState::try_deserialize(&mut &account.data[..]).expect("the state must deserialize")
}

async fn read_claim_receipt(context: &mut ProgramTestContext, receipt: Pubkey) -> ClaimReceipt {
    let account = context
        .banks_client
        .get_account(receipt)
        .await
        .expect("a transport error")
        .expect("the claim receipt must exist");
    ClaimReceipt::try_deserialize(&mut &account.data[..]).expect("the receipt must deserialize")
}

/// Build the bytes of a Metaplex Core `AssetV1` account, using the same offsets
/// the unit tests in `src/mpl_core.rs` assert.
fn core_asset(owner: &Pubkey, collection: &Pubkey) -> Vec<u8> {
    core_asset_with_uri(
        owner,
        collection,
        "https://metadata.example.invalid/templates/7/citizen-13.json",
    )
}

fn core_asset_with_uri(owner: &Pubkey, collection: &Pubkey, uri: &str) -> Vec<u8> {
    let mut data = Vec::new();
    data.push(mpl_core::KEY_ASSET_V1);
    data.extend_from_slice(owner.as_ref());
    data.push(mpl_core::UPDATE_AUTHORITY_COLLECTION);
    data.extend_from_slice(collection.as_ref());
    for text in ["Citizen #13", uri] {
        data.extend_from_slice(&(text.len() as u32).to_le_bytes());
        data.extend_from_slice(text.as_bytes());
    }
    // seq: Option<u64> == Some(1)
    data.push(1);
    data.extend_from_slice(&1u64.to_le_bytes());
    data
}

/// Install an account that looks exactly like a Core asset: owned by the Core
/// program and holding asset bytes.
fn install_asset(context: &mut ProgramTestContext, harness: &Harness, asset: Pubkey, data: Vec<u8>) {
    install_account(context, asset, data, harness.mpl_core_key());
}

/// Install an account with an arbitrary owner, used to prove that the `owner =
/// mpl_core_program` constraint is what makes the asset bytes trustworthy.
fn install_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    data: Vec<u8>,
    owner: Pubkey,
) {
    // `ProgramTestContext::set_account` takes `&AccountSharedData`, whose data
    // setter is private; the public route is `From<solana_sdk::account::Account>`.
    let lamports = Rent::default().minimum_balance(data.len().max(1));
    context.set_account(
        &address,
        &AccountSharedData::from(solana_sdk::account::Account {
            lamports,
            data,
            owner,
            executable: false,
            rent_epoch: u64::MAX,
        }),
    );
}

fn mint_account(authority: &Pubkey, supply: u64) -> AccountSharedData {
    let mut data = vec![0u8; SplMint::LEN];
    SplMint {
        mint_authority: Option::<Pubkey>::from(*authority).into(),
        supply,
        decimals: TOKEN_DECIMALS,
        is_initialized: true,
        freeze_authority: Option::<Pubkey>::None.into(),
    }
    .pack_into_slice(&mut data);

    spl_account(data)
}

fn token_account(mint: &Pubkey, owner: &Pubkey, amount: u64) -> AccountSharedData {
    let mut data = vec![0u8; SplTokenAccount::LEN];
    SplTokenAccount {
        mint: *mint,
        owner: *owner,
        amount,
        delegate: Option::<Pubkey>::None.into(),
        state: AccountState::Initialized,
        is_native: Option::<u64>::None.into(),
        delegated_amount: 0,
        close_authority: Option::<Pubkey>::None.into(),
    }
    .pack_into_slice(&mut data);

    spl_account(data)
}

/// An SPL Token account: packed data, owned by the token program.
fn spl_account(data: Vec<u8>) -> AccountSharedData {
    AccountSharedData::from(solana_sdk::account::Account {
        lamports: 10_000_000_000,
        data,
        owner: token::ID,
        executable: false,
        rent_epoch: u64::MAX,
    })
}

/// Write a `CitizenState` directly, for the cases an instruction cannot reach:
/// a score already at the maximum, or a credit pool that would take nine claims
/// to fill.
///
/// This is a test fixture, not a way the program can be driven — the account is
/// a PDA owned by the district program, and only the program can normally write
/// it.
fn install_citizen(context: &mut ProgramTestContext, citizen_state: Pubkey, citizen: &CitizenState) {
    let mut data: Vec<u8> = Vec::with_capacity(CitizenState::LEN);
    citizen
        .try_serialize(&mut data)
        .expect("the state must serialize into its own LEN");
    assert_eq!(data.len(), CitizenState::LEN, "CitizenState::LEN is wrong");
    install_account(context, citizen_state, data, district::ID);
}

fn citizen_fixture(harness: &Harness, asset: Pubkey, role: CitizenRole) -> CitizenState {
    let template = role.template();
    CitizenState {
        version: CITIZEN_STATE_VERSION,
        bump: harness.citizen_pda(&asset).1,
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

async fn token_balance(context: &mut ProgramTestContext, account: Pubkey) -> u64 {
    let stored = context
        .banks_client
        .get_account(account)
        .await
        .expect("a transport error")
        .expect("the token account must exist");
    SplTokenAccount::unpack(&stored.data)
        .expect("a packed SPL token account")
        .amount
}

/// The mint's total supply, which only drops when tokens are really burned.
async fn token_supply(context: &mut ProgramTestContext, mint: Pubkey) -> u64 {
    let stored = context
        .banks_client
        .get_account(mint)
        .await
        .expect("a transport error")
        .expect("the mint must exist");
    SplMint::unpack(&stored.data)
        .expect("a packed SPL mint")
        .supply
}

// ---------------------------------------------------------------------------
// instruction builders
// ---------------------------------------------------------------------------

fn initialize_config_instruction(harness: &Harness, start_paused: bool) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::InitializeConfig {
            config: harness.config_key(),
            approved_template: harness.template_key(),
            admin: harness.admin_key(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::InitializeConfig {
            args: InitializeConfigArgs {
                mission_authority: harness.mission_authority_key(),
                sol_treasury: harness.sol_treasury,
                collection_mint: harness.collection_key(),
                approved_template_id: APPROVED_TEMPLATE_ID,
                approved_template_uri_prefix: APPROVED_TEMPLATE_URI_PREFIX.to_string(),
                base_training_cost: BASE_TRAINING_COST,
                start_paused,
            },
        }
        .data(),
    }
}

fn set_utility_mint_instruction(harness: &Harness, admin: Pubkey, utility_mint: Pubkey) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::SetUtilityMint {
            config: harness.config_key(),
            utility_mint,
            admin,
        }
        .to_account_metas(None),
        data: instruction::SetUtilityMint.data(),
    }
}

fn lock_utility_mint_instruction(harness: &Harness, admin: Pubkey) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::LockUtilityMint {
            config: harness.config_key(),
            admin,
        }
        .to_account_metas(None),
        data: instruction::LockUtilityMint.data(),
    }
}

fn update_config_instruction(harness: &Harness, args: UpdateConfigArgs) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::UpdateConfigAccounts {
            config: harness.config_key(),
            admin: harness.admin_key(),
        }
        .to_account_metas(None),
        data: instruction::UpdateConfig { args }.data(),
    }
}

fn set_paused_instruction(harness: &Harness, admin: Pubkey, paused: bool) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::SetPaused {
            config: harness.config_key(),
            admin,
        }
        .to_account_metas(None),
        data: instruction::SetPaused { paused }.data(),
    }
}

fn register_instruction(harness: &Harness, asset: Pubkey, owner: Pubkey, role: u8) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::RegisterCitizen {
            config: harness.config_key(),
            asset,
            mpl_core_program: harness.mpl_core_key(),
            approved_template: harness.template_key(),
            citizen_state: harness.citizen_pda(&asset).0,
            owner,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::RegisterCitizen { role }.data(),
    }
}

fn claim_instruction(
    harness: &Harness,
    asset: Pubkey,
    citizen_state: Pubkey,
    owner: Pubkey,
    mission_authority: Pubkey,
    args: MissionClaimArgs,
    receipt: Pubkey,
) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::ClaimTrainingCredit {
            config: harness.config_key(),
            citizen_state,
            asset,
            mpl_core_program: harness.mpl_core_key(),
            mission_authority,
            owner,
            claim_receipt: receipt,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::ClaimTrainingCredit { args }.data(),
    }
}

fn upgrade_instruction(
    harness: &Harness,
    asset: Pubkey,
    citizen_state: Pubkey,
    owner: Pubkey,
    utility_mint: Pubkey,
    user_token_account: Pubkey,
    stat_index: u8,
) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::UpgradeScore {
            config: harness.config_key(),
            citizen_state,
            asset,
            mpl_core_program: harness.mpl_core_key(),
            owner,
            utility_mint,
            user_token_account,
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::UpgradeScore { stat_index }.data(),
    }
}

fn propose_admin_instruction(harness: &Harness, proposed_admin: Pubkey) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::ProposeAdmin {
            config: harness.config_key(),
            admin: harness.admin_key(),
        }
        .to_account_metas(None),
        data: instruction::ProposeAdmin { proposed_admin }.data(),
    }
}

fn accept_admin_instruction(harness: &Harness, new_admin: Pubkey) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::AcceptAdmin {
            config: harness.config_key(),
            new_admin,
        }
        .to_account_metas(None),
        data: instruction::AcceptAdmin.data(),
    }
}

// ---------------------------------------------------------------------------
// shared setup steps
// ---------------------------------------------------------------------------

/// `initialize_config` with the test's parameters.
async fn initialize(context: &mut ProgramTestContext, harness: &Harness) {
    initialize_with(context, harness, false).await;
}

async fn initialize_with(context: &mut ProgramTestContext, harness: &Harness, start_paused: bool) {
    if let Err(error) = send(
        context,
        initialize_config_instruction(harness, start_paused),
        &[&harness.admin],
    )
    .await
    {
        panic!("initialize_config must succeed, got {error}");
    }
}

/// Install the utility mint fixture, then bind it with `set_utility_mint`.
async fn bind_utility_mint(context: &mut ProgramTestContext, harness: &Harness) {
    context.set_account(&harness.utility_mint_key(), &mint_account(&context.payer.pubkey(), TOKEN_SUPPLY));
    send(
        context,
        set_utility_mint_instruction(harness, harness.admin_key(), harness.utility_mint_key()),
        &[&harness.admin],
    )
    .await
    .expect("binding a real initialized mint must succeed");
}

/// A fully configured district: initialized, mint bound, not paused.
async fn bootstrap(context: &mut ProgramTestContext, harness: &Harness) {
    initialize(context, harness).await;
    bind_utility_mint(context, harness).await;
}

/// Install a genuine collection member owned by the holder.
fn install_member(context: &mut ProgramTestContext, harness: &Harness) -> Pubkey {
    let asset = Pubkey::new_unique();
    install_asset(
        context,
        harness,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
    );
    asset
}

/// Register a genuine collection member as a Pioneer.
async fn register_member(context: &mut ProgramTestContext, harness: &Harness) -> (Pubkey, Pubkey) {
    register_role(context, harness, CitizenRole::Pioneer).await
}

async fn register_role(
    context: &mut ProgramTestContext,
    harness: &Harness,
    role: CitizenRole,
) -> (Pubkey, Pubkey) {
    let asset = install_member(context, harness);
    send(
        context,
        register_instruction(harness, asset, harness.holder_key(), role as u8),
        &[&harness.holder],
    )
    .await
    .expect("registering a genuine collection member must succeed");
    (asset, harness.citizen_pda(&asset).0)
}

/// Grant the holder one credit of one kind through a real authorized claim.
///
/// Going through the instruction rather than writing the PDA is the point: the
/// credit has to be one the program itself would grant.
async fn claim_credit(
    context: &mut ProgramTestContext,
    harness: &Harness,
    asset: Pubkey,
    citizen_state: Pubkey,
    stat: CitizenStat,
    mission_id: u64,
) {
    let nonce = mission_id * 1_000 + u64::from(stat as u8);
    let (receipt, _) = harness.claim_receipt_pda(&asset, mission_id, nonce);
    send(
        context,
        claim_instruction(
            harness,
            asset,
            citizen_state,
            harness.holder_key(),
            harness.mission_authority_key(),
            MissionClaimArgs {
                stat: stat as u8,
                mission_id,
                season_id: 1,
                nonce,
                expires_at: NOW + AN_HOUR,
            },
            receipt,
        ),
        &[&harness.holder, &harness.mission_authority],
    )
    .await
    .expect("an authorized, unexpired claim must succeed");
}

/// A registered citizen, the bound utility mint, and a token account for the
/// holder holding `balance` atoms.
struct Training {
    asset: Pubkey,
    citizen_state: Pubkey,
    user_token_account: Pubkey,
}

async fn setup_training(
    context: &mut ProgramTestContext,
    harness: &Harness,
    balance: u64,
) -> Training {
    let (asset, citizen_state) = register_member(context, harness).await;

    let user_token_account = Pubkey::new_unique();
    context.set_account(
        &user_token_account,
        &token_account(&harness.utility_mint_key(), &harness.holder_key(), balance),
    );

    Training {
        asset,
        citizen_state,
        user_token_account,
    }
}

/// `upgrade_score` for the holder against a `Training` setup.
async fn upgrade(
    context: &mut ProgramTestContext,
    harness: &Harness,
    setup: &Training,
    stat: CitizenStat,
) -> SendResult {
    send(
        context,
        upgrade_instruction(
            harness,
            setup.asset,
            setup.citizen_state,
            harness.holder_key(),
            harness.utility_mint_key(),
            setup.user_token_account,
            stat as u8,
        ),
        &[&harness.holder],
    )
    .await
}

// ---------------------------------------------------------------------------
// initialize_config
// ---------------------------------------------------------------------------

#[tokio::test]
async fn initialize_writes_the_config_pda() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.version, DISTRICT_CONFIG_VERSION);
    assert_eq!(config.admin, harness.admin_key());
    assert_eq!(config.mission_authority, harness.mission_authority_key());
    assert_eq!(config.sol_treasury, harness.sol_treasury);
    assert_eq!(config.collection_mint, harness.collection_key());
    assert_eq!(config.approved_template_id, APPROVED_TEMPLATE_ID);
    assert_eq!(config.base_training_cost, BASE_TRAINING_COST);
    let template = read_approved_template(&mut context, &harness).await;
    assert_eq!(template.version, APPROVED_TEMPLATE_VERSION);
    assert_eq!(template.template_id, APPROVED_TEMPLATE_ID);
    assert_eq!(template.uri_prefix, APPROVED_TEMPLATE_URI_PREFIX);
    assert_eq!(
        template.bump,
        Pubkey::find_program_address(
            &[b"approved_template", &APPROVED_TEMPLATE_ID.to_le_bytes()],
            &district::ID,
        )
        .1
    );
    assert_eq!(config.total_registered_citizens, 0);
    assert!(!config.is_paused);
    assert_eq!(
        config.bump,
        Pubkey::find_program_address(&[b"district_config"], &district::ID).1
    );

    // §5.7: the token is launched after the program, so the mint starts unset
    // and unlocked. §15.4 test 4 depends on "unset" being distinguishable.
    assert_eq!(config.utility_mint, Pubkey::default());
    assert!(!config.utility_mint_locked);
    // No admin transfer is pending.
    assert_eq!(config.pending_admin, Pubkey::default());
}

#[tokio::test]
async fn initialize_can_only_run_once() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // Two identical transactions would share a signature, so warp first.
    advance(&mut context, &harness).await;

    let result = send(
        &mut context,
        initialize_config_instruction(&harness, false),
        &[&harness.admin],
    )
    .await;
    // §13 lists `AlreadyInitialized`, but this program cannot report it: the
    // `init` constraint on the config PDA refuses the second initialization
    // before any handler runs, and what surfaces is the system program's own
    // `AccountAlreadyInUse` from the create-account CPI. Declaring an
    // unreachable variant would put a lie in the error list, so the test asserts
    // the code that really comes back.
    let failure = result.expect_err("initialization must not run twice");
    assert_eq!(
        custom_error_code(&failure),
        SystemError::AccountAlreadyInUse as u32,
        "expected the system program to refuse re-creating the PDA, got {failure}"
    );

    assert_eq!(
        read_config(&mut context, &harness).await.admin,
        harness.admin_key(),
        "a rejected initialization must not rewrite the config"
    );
}

#[tokio::test]
async fn initialize_can_start_the_district_paused() {
    let (mut context, harness) = start().await;
    // AGENT_START_HERE.md §4: mainnet infrastructure is deployed paused.
    initialize_with(&mut context, &harness, true).await;

    assert!(read_config(&mut context, &harness).await.is_paused);
}

// ---------------------------------------------------------------------------
// set_utility_mint / lock_utility_mint
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_utility_mint_can_be_set_before_it_is_locked() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    bind_utility_mint(&mut context, &harness).await;

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.utility_mint, harness.utility_mint_key());
    assert!(!config.utility_mint_locked);

    // §15.4 test 1: it can be set again while unlocked, which is what allows a
    // devnet mirror token to be corrected before the binding is made permanent.
    let replacement = Keypair::new();
    context.set_account(&replacement.pubkey(), &mint_account(&context.payer.pubkey(), TOKEN_SUPPLY));
    send(
        &mut context,
        set_utility_mint_instruction(&harness, harness.admin_key(), replacement.pubkey()),
        &[&harness.admin],
    )
    .await
    .expect("an unlocked mint must be replaceable");
    assert_eq!(read_config(&mut context, &harness).await.utility_mint, replacement.pubkey());
}

#[tokio::test]
async fn the_utility_mint_cannot_be_changed_after_the_lock() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    send(
        &mut context,
        lock_utility_mint_instruction(&harness, harness.admin_key()),
        &[&harness.admin],
    )
    .await
    .expect("the admin must be able to lock the mint");
    assert!(read_config(&mut context, &harness).await.utility_mint_locked);

    // §15.4 test 2, and §5.2: never a second upgrade token.
    let replacement = Keypair::new();
    context.set_account(&replacement.pubkey(), &mint_account(&context.payer.pubkey(), TOKEN_SUPPLY));
    let result = send(
        &mut context,
        set_utility_mint_instruction(&harness, harness.admin_key(), replacement.pubkey()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::UtilityMintLocked);

    // Locking twice is refused too: the flag is not a toggle.
    advance(&mut context, &harness).await;
    let result = send(
        &mut context,
        lock_utility_mint_instruction(&harness, harness.admin_key()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::UtilityMintLocked);

    assert_eq!(
        read_config(&mut context, &harness).await.utility_mint,
        harness.utility_mint_key(),
        "the bound mint must survive every rejected attempt"
    );
}

#[tokio::test]
async fn binding_something_that_is_not_a_mint_is_refused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // An account with the right owner but no mint inside it. Without the
    // unpack check this would bind and every later burn would be unverifiable.
    let empty = Keypair::new();
    context.set_account(&empty.pubkey(), &spl_account(vec![0u8; SplMint::LEN]));
    let result = send(
        &mut context,
        set_utility_mint_instruction(&harness, harness.admin_key(), empty.pubkey()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidUtilityMint);

    // So is an account too short to hold a mint at all.
    let short = Keypair::new();
    context.set_account(&short.pubkey(), &spl_account(vec![0u8; 8]));
    let result = send(
        &mut context,
        set_utility_mint_instruction(&harness, harness.admin_key(), short.pubkey()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidUtilityMint);

    assert_eq!(read_config(&mut context, &harness).await.utility_mint, Pubkey::default());
}

#[tokio::test]
async fn locking_before_a_mint_is_bound_is_refused() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // Locking an unset mint would permanently disable upgrading (§15.4 test 4),
    // so it is refused rather than allowed to brick the district.
    let result = send(
        &mut context,
        lock_utility_mint_instruction(&harness, harness.admin_key()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::UtilityMintNotSet);
    assert!(!read_config(&mut context, &harness).await.utility_mint_locked);
}

#[tokio::test]
async fn only_the_admin_can_touch_the_utility_mint() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    context.set_account(&harness.utility_mint_key(), &mint_account(&context.payer.pubkey(), TOKEN_SUPPLY));

    let result = send(
        &mut context,
        set_utility_mint_instruction(&harness, harness.impostor_key(), harness.utility_mint_key()),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);

    let result = send(
        &mut context,
        lock_utility_mint_instruction(&harness, harness.impostor_key()),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.utility_mint, Pubkey::default());
    assert!(!config.utility_mint_locked);
}

// ---------------------------------------------------------------------------
// update_config
// ---------------------------------------------------------------------------

#[tokio::test]
async fn update_config_changes_operational_parameters_only() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let new_mission_authority = Pubkey::new_unique();
    let new_treasury = Pubkey::new_unique();
    send(
        &mut context,
        update_config_instruction(
            &harness,
            UpdateConfigArgs {
                mission_authority: new_mission_authority,
                sol_treasury: new_treasury,
                base_training_cost: BASE_TRAINING_COST * 2,
            },
        ),
        &[&harness.admin],
    )
    .await
    .expect("the admin must be able to update operational parameters");

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.mission_authority, new_mission_authority);
    assert_eq!(config.sol_treasury, new_treasury);
    assert_eq!(config.approved_template_id, APPROVED_TEMPLATE_ID);
    assert_eq!(config.base_training_cost, BASE_TRAINING_COST * 2);
    assert_eq!(
        read_approved_template(&mut context, &harness).await.uri_prefix,
        APPROVED_TEMPLATE_URI_PREFIX,
        "the approved-template registry is immutable after initialization"
    );

    // §17: devnet and mainnet differ by addresses and config, not by
    // architecture. An instruction that could rewrite the collection, the mint
    // binding, the admin or the counter would be a rug vector, so none of them
    // is reachable from here.
    assert_eq!(config.collection_mint, harness.collection_key());
    assert_eq!(config.utility_mint, harness.utility_mint_key());
    assert_eq!(config.admin, harness.admin_key());
    assert_eq!(config.total_registered_citizens, 0);
    assert!(!config.utility_mint_locked);
    assert!(!config.is_paused);
}

// ---------------------------------------------------------------------------
// set_paused
// ---------------------------------------------------------------------------

#[tokio::test]
async fn only_the_admin_can_pause() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let result = send(
        &mut context,
        set_paused_instruction(&harness, harness.impostor_key(), true),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);

    assert!(
        !read_config(&mut context, &harness).await.is_paused,
        "a rejected pause must not change the config"
    );
}

#[tokio::test]
async fn pauses_and_resumes_and_rewriting_the_same_value_is_harmless() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), true),
        &[&harness.admin],
    )
    .await
    .expect("the admin must be able to pause");
    let config = read_config(&mut context, &harness).await;
    assert!(config.is_paused);
    let before = (
        config.admin,
        config.utility_mint,
        config.collection_mint,
        config.base_training_cost,
        config.total_registered_citizens,
        config.bump,
    );

    // Two identical transactions from the same payer on the same blockhash share
    // a signature, which the bank rejects as AlreadyProcessed before the program
    // runs, so the slot has to move between them.
    advance(&mut context, &harness).await;

    send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), true),
        &[&harness.admin],
    )
    .await
    .expect("repeating paused=true must still succeed");

    let repeated = read_config(&mut context, &harness).await;
    assert_eq!(
        (
            repeated.admin,
            repeated.utility_mint,
            repeated.collection_mint,
            repeated.base_training_cost,
            repeated.total_registered_citizens,
            repeated.bump,
        ),
        before,
        "an unchanged value must leave the rest of the config alone"
    );

    send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), false),
        &[&harness.admin],
    )
    .await
    .expect("the admin must be able to resume");
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
        setup.asset,
        setup.citizen_state,
        CitizenStat::Intelligence,
        1,
    )
    .await;

    send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), true),
        &[&harness.admin],
    )
    .await
    .expect("the admin must be able to pause");

    // A paused district refuses all three state-changing public instructions.
    let asset = install_member(&mut context, &harness);
    let result = send(
        &mut context,
        register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Pioneer as u8),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::ProgramPaused);

    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::ProgramPaused);

    let (receipt, _) = harness.claim_receipt_pda(&setup.asset, 99, 99);
    let result = send(
        &mut context,
        claim_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.holder_key(),
            harness.mission_authority_key(),
            MissionClaimArgs {
                stat: CitizenStat::Intelligence as u8,
                mission_id: 99,
                season_id: 1,
                nonce: 99,
                expires_at: NOW + AN_HOUR,
            },
            receipt,
        ),
        &[&harness.holder, &harness.mission_authority],
    )
    .await;
    expect_error_code(result, DistrictError::ProgramPaused);

    // Nothing moved.
    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.insight_training_credits, 1, "the paused claim must not grant a credit");
    assert_eq!(citizen.intelligence, 1, "the paused upgrade must not raise the score");
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 1);
}

// ---------------------------------------------------------------------------
// register_citizen
// ---------------------------------------------------------------------------

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
    assert_eq!(
        citizen.bump,
        Pubkey::find_program_address(&[b"citizen", asset.as_ref()], &district::ID).1,
        "§6.4: the seed is [\"citizen\", asset]"
    );
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 1);
}

#[tokio::test]
async fn initial_stats_come_from_the_role_registry_not_from_the_caller() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // This is the hole the old instruction had: it took initial_int/aln/cmp as
    // arguments, so anyone could pass 10,10,10 and start at the maximum score
    // without burning a token. There is no such argument now — the only thing a
    // caller chooses is the role, and the registry decides what that is worth.
    for role in [CitizenRole::Pioneer, CitizenRole::Scholar, CitizenRole::Artisan] {
        let (asset, citizen_state) = register_role(&mut context, &harness, role).await;
        let citizen = read_citizen(&mut context, citizen_state).await;
        let template = role.template();

        assert_eq!(citizen.role, template.index);
        assert_eq!(citizen.intelligence, template.initial_intelligence);
        assert_eq!(citizen.alignment, template.initial_alignment);
        assert_eq!(citizen.compute, template.initial_compute);
        assert_eq!(citizen.asset, asset);

        // No role may start anywhere near the maximum (§7: max is 10).
        for score in [citizen.intelligence, citizen.alignment, citizen.compute] {
            assert!(score < STAT_MAX);
        }
    }

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.total_registered_citizens, 3);
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
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 3);
}

#[tokio::test]
async fn registration_grants_no_training_credits() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let (_, citizen_state) = register_member(&mut context, &harness).await;
    let citizen = read_citizen(&mut context, citizen_state).await;

    // §5.3: credits cannot be bought and are earned from authorized missions or
    // verified district events. Granting any at registration would let a citizen
    // be trained without a single mission, which is the thing the credit exists
    // to prevent.
    assert_eq!(citizen.insight_training_credits, 0);
    assert_eq!(citizen.bond_training_credits, 0);
    assert_eq!(citizen.craft_training_credits, 0);
}

#[tokio::test]
async fn rejects_an_asset_from_a_foreign_collection() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // Correct layout, correct owner, wrong collection.
    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset(&harness.holder_key(), &Pubkey::new_unique()),
    );

    let result = send(
        &mut context,
        register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Pioneer as u8),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidCollection);
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 0);
}

#[tokio::test]
async fn rejects_an_asset_the_signer_does_not_own() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // Right collection, but the asset belongs to somebody else. The impostor
    // signs and passes their own key as `owner`.
    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
    );

    let result = send(
        &mut context,
        register_instruction(&harness, asset, harness.impostor_key(), CitizenRole::Pioneer as u8),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::NotOwner);
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 0);
}

#[tokio::test]
async fn rejects_accounts_that_are_not_collection_member_assets() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // Each of these is owned by the Core program, so the `owner` constraint
    // passes and the parser is what has to refuse them.
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty", vec![]),
        ("uninitialized key", {
            let mut data = core_asset(&harness.holder_key(), &harness.collection_key());
            data[0] = 0;
            data
        }),
        ("compressed asset", {
            let mut data = core_asset(&harness.holder_key(), &harness.collection_key());
            data[0] = mpl_core::KEY_HASHED_ASSET_V1;
            data
        }),
        ("collection account", {
            let mut data = core_asset(&harness.holder_key(), &harness.collection_key());
            data[0] = mpl_core::KEY_COLLECTION_V1;
            data
        }),
        ("standalone asset", {
            let mut data = core_asset(&harness.holder_key(), &harness.collection_key());
            data[mpl_core::UPDATE_AUTHORITY_TAG_OFFSET] = 1;
            data
        }),
        ("truncated", {
            let data = core_asset(&harness.holder_key(), &harness.collection_key());
            data[..mpl_core::MIN_ASSET_PREFIX_LEN - 1].to_vec()
        }),
    ];

    for (label, data) in cases {
        let asset = Pubkey::new_unique();
        install_asset(&mut context, &harness, asset, data);
        let result = send(
            &mut context,
            register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Pioneer as u8),
            &[&harness.holder],
        )
        .await;
        expect_error_code(result, DistrictError::InvalidAssetState);
        assert_eq!(
            read_config(&mut context, &harness).await.total_registered_citizens,
            0,
            "{label} must not have been registered"
        );
    }
}

#[tokio::test]
async fn rejects_an_asset_that_is_not_owned_by_the_core_program() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // The bytes describe a perfect collection member, but the account is owned
    // by the holder instead of Metaplex Core. This is the forgery the parser
    // alone could not catch: anyone can write 66 bytes that look like an asset
    // of the right collection into an account they own. The `owner =
    // mpl_core_program` constraint is what stops it, and it fires before the
    // parser is reached — hence Anchor's ConstraintOwner (2004), not a §13 code.
    let asset = Pubkey::new_unique();
    install_account(
        &mut context,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
        harness.holder_key(),
    );

    let result = send(
        &mut context,
        register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Pioneer as u8),
        &[&harness.holder],
    )
    .await;
    let failure = result.expect_err("a self-owned account must not pass as a Core asset");
    assert_eq!(
        custom_error_code(&failure),
        u32::from(anchor_lang::error::ErrorCode::ConstraintOwner),
        "expected ConstraintOwner (2004), got {failure}"
    );
}

#[tokio::test]
async fn rejects_an_asset_with_an_unapproved_metadata_template_uri() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // The Core account is otherwise valid and belongs to the configured
    // collection, but its immutable URI names template 8 instead of template 7.
    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset_with_uri(
            &harness.holder_key(),
            &harness.collection_key(),
            "https://metadata.example.invalid/templates/8/citizen-13.json",
        ),
    );

    let result = send(
        &mut context,
        register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Pioneer as u8),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidAssetState);
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 0);
    assert!(
        context
            .banks_client
            .get_account(harness.citizen_pda(&asset).0)
            .await
            .expect("a transport error")
            .is_none(),
        "an unapproved URI must not create CitizenState"
    );
}

#[tokio::test]
async fn rejects_a_role_that_is_not_in_the_registry() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // §6.3 item 4: the template is read from the registry, so a role that is
    // not in it has no defined initial stats and must not be guessed.
    for role in [ROLE_COUNT as u8, ROLE_COUNT as u8 + 1, 255] {
        let asset = install_member(&mut context, &harness);
        let result = send(
            &mut context,
            register_instruction(&harness, asset, harness.holder_key(), role),
            &[&harness.holder],
        )
        .await;
        expect_error_code(result, DistrictError::InvalidRole);
    }
    assert_eq!(read_config(&mut context, &harness).await.total_registered_citizens, 0);
}

#[tokio::test]
async fn cannot_register_the_same_asset_twice() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let (asset, citizen_state) = register_member(&mut context, &harness).await;
    let first = read_citizen(&mut context, citizen_state).await;

    // Two identical transactions share a signature, so warp before replaying.
    advance(&mut context, &harness).await;

    let result = send(
        &mut context,
        register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Scholar as u8),
        &[&harness.holder],
    )
    .await;
    // A replay cannot reach the handler: the `init` constraint on the citizen PDA
    // CPIs into the system program to create it, and the system program refuses
    // because it already exists. §13 names this `CitizenAlreadyRegistered`, but
    // no code of this program can report it, so the variant is not declared —
    // what a client really sees is the system program's own error 0.
    let failure = result.expect_err("a replayed registration must fail");
    assert_eq!(
        custom_error_code(&failure),
        SystemError::AccountAlreadyInUse as u32,
        "expected the system program to refuse re-creating the citizen PDA, got {failure}"
    );

    let after = read_citizen(&mut context, citizen_state).await;
    assert_eq!(after.citizen_id, first.citizen_id);
    assert_eq!(after.role, first.role, "a replay must not change the role");
    assert_eq!(
        read_config(&mut context, &harness).await.total_registered_citizens,
        1,
        "a replay must not inflate the counter"
    );
}

// ---------------------------------------------------------------------------
// claim_training_credit
// ---------------------------------------------------------------------------

#[tokio::test]
async fn an_authorized_claim_adds_exactly_one_matching_credit() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // §15.3 test 1: the credit lands in the pool of the stat it was claimed for,
    // and nowhere else.
    claim_credit(&mut context, &harness, asset, citizen_state, CitizenStat::Alignment, 11).await;

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(citizen.bond_training_credits, 1);
    assert_eq!(citizen.insight_training_credits, 0);
    assert_eq!(citizen.craft_training_credits, 0);

    // The receipt records everything the claim was bound to, so an auditor can
    // check afterwards that the credit was granted for this asset, stat,
    // mission, season, owner and nonce.
    let nonce = 11 * 1_000 + u64::from(CitizenStat::Alignment as u8);
    let (receipt, _) = harness.claim_receipt_pda(&asset, 11, nonce);
    let stored = read_claim_receipt(&mut context, receipt).await;
    assert_eq!(stored.asset, asset);
    assert_eq!(stored.owner, harness.holder_key());
    assert_eq!(stored.mission_id, 11);
    assert_eq!(stored.season_id, 1);
    assert_eq!(stored.stat, CitizenStat::Alignment as u8);
    assert_eq!(stored.nonce, nonce);
    assert_eq!(stored.expires_at, NOW + AN_HOUR);
    assert_eq!(stored.claimed_at, NOW);
}

#[tokio::test]
async fn a_mission_claim_cannot_be_replayed() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let args = MissionClaimArgs {
        stat: CitizenStat::Intelligence as u8,
        mission_id: 21,
        season_id: 1,
        nonce: 77,
        expires_at: NOW + AN_HOUR,
    };
    let (receipt, _) = harness.claim_receipt_pda(&asset, args.mission_id, args.nonce);
    let instruction = claim_instruction(
        &harness,
        asset,
        citizen_state,
        harness.holder_key(),
        harness.mission_authority_key(),
        args,
        receipt,
    );

    send(&mut context, instruction.clone(), &[&harness.holder, &harness.mission_authority])
        .await
        .expect("the first claim must succeed");
    assert_eq!(read_citizen(&mut context, citizen_state).await.insight_training_credits, 1);

    // §15.3 test 2. The signature is identical, so the bank would reject it as
    // AlreadyProcessed before the program ran; warp so the replay actually
    // reaches the instruction and is refused for the right reason.
    advance(&mut context, &harness).await;

    let result = send(&mut context, instruction, &[&harness.holder, &harness.mission_authority]).await;
    expect_error_code(result, DistrictError::MissionClaimAlreadyUsed);
    assert_eq!(
        read_citizen(&mut context, citizen_state).await.insight_training_credits,
        1,
        "a replayed claim must not grant a second credit"
    );
}

#[tokio::test]
async fn an_expired_claim_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // §15.3 test 3. A claim signed to expire in the past cannot be held and
    // presented later.
    for expires_at in [NOW - 1, NOW, i64::MIN] {
        let nonce = 5_000 + expires_at.unsigned_abs() % 1_000;
        let (receipt, _) = harness.claim_receipt_pda(&asset, 31, nonce);
        let result = send(
            &mut context,
            claim_instruction(
                &harness,
                asset,
                citizen_state,
                harness.holder_key(),
                harness.mission_authority_key(),
                MissionClaimArgs {
                    stat: CitizenStat::Intelligence as u8,
                    mission_id: 31,
                    season_id: 1,
                    nonce,
                    expires_at,
                },
                receipt,
            ),
            &[&harness.holder, &harness.mission_authority],
        )
        .await;
        expect_error_code(result, DistrictError::MissionClaimExpired);
    }

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(citizen.insight_training_credits, 0);
}

#[tokio::test]
async fn a_claim_for_somebody_elses_citizen_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // The impostor signs as owner and presents a receipt PDA derived for their
    // own key, so the only thing standing between them and a credit on somebody
    // else's citizen is the ownership check against the Core asset.
    let nonce = 42u64;
    let (receipt, _) = harness.claim_receipt_pda(&asset, 41, nonce);
    let result = send(
        &mut context,
        claim_instruction(
            &harness,
            asset,
            citizen_state,
            harness.impostor_key(),
            harness.mission_authority_key(),
            MissionClaimArgs {
                stat: CitizenStat::Intelligence as u8,
                mission_id: 41,
                season_id: 1,
                nonce,
                expires_at: NOW + AN_HOUR,
            },
            receipt,
        ),
        // The impostor pays for the receipt they are asking for.
        &[&harness.impostor, &harness.mission_authority],
    )
    .await;
    expect_error_code(result, DistrictError::NotOwner);
    assert_eq!(read_citizen(&mut context, citizen_state).await.insight_training_credits, 0);
}

#[tokio::test]
async fn a_claim_the_mission_authority_did_not_sign_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // §12: the claim requires the authorized mission authority's signature.
    // The impostor signs here, so what stops them is not the signature but the
    // constraint comparing this account against `config.mission_authority`.
    let (receipt, _) = harness.claim_receipt_pda(&asset, 51, 1);
    let result = send(
        &mut context,
        claim_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            harness.impostor_key(),
            MissionClaimArgs {
                stat: CitizenStat::Intelligence as u8,
                mission_id: 51,
                season_id: 1,
                nonce: 1,
                expires_at: NOW + AN_HOUR,
            },
            receipt,
        ),
        &[&harness.holder, &harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidMissionClaim);
    assert_eq!(read_citizen(&mut context, citizen_state).await.insight_training_credits, 0);
}

#[tokio::test]
async fn a_citizen_owner_cannot_appoint_themselves_mission_authority() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // The holder signs both positions: `owner` and `mission_authority`. Nothing
    // in this instruction is derived from the mission authority — the receipt
    // PDA comes from the asset, the mission and the nonce — so if the comparison
    // against the config lived in the handler instead of in a constraint, this
    // transaction would satisfy it and the holder could mint themselves
    // unlimited Training Credits. That is the whole gate between "bought tokens"
    // and "maxed a citizen" (§5.3), so it is worth a test of its own.
    let (receipt, _) = harness.claim_receipt_pda(&asset, 52, 1);
    let result = send(
        &mut context,
        claim_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            harness.holder_key(),
            MissionClaimArgs {
                stat: CitizenStat::Intelligence as u8,
                mission_id: 52,
                season_id: 1,
                nonce: 1,
                expires_at: NOW + AN_HOUR,
            },
            receipt,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidMissionClaim);

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(
        (
            citizen.insight_training_credits,
            citizen.bond_training_credits,
            citizen.craft_training_credits
        ),
        (0, 0, 0),
        "a self-appointed authority must not be able to grant a credit"
    );
}

#[tokio::test]
async fn a_claim_for_an_unknown_stat_is_rejected() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    // A credit of an unknown kind would have no pool to land in.
    for stat in [3u8, 9, 255] {
        let (receipt, _) = harness.claim_receipt_pda(&asset, 61, u64::from(stat));
        let result = send(
            &mut context,
            claim_instruction(
                &harness,
                asset,
                citizen_state,
                harness.holder_key(),
                harness.mission_authority_key(),
                MissionClaimArgs {
                    stat,
                    mission_id: 61,
                    season_id: 1,
                    nonce: u64::from(stat),
                    expires_at: NOW + AN_HOUR,
                },
                receipt,
            ),
            &[&harness.holder, &harness.mission_authority],
        )
        .await;
        expect_error_code(result, DistrictError::InvalidStat);
    }

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(
        (
            citizen.insight_training_credits,
            citizen.bond_training_credits,
            citizen.craft_training_credits
        ),
        (0, 0, 0)
    );
}

// ---------------------------------------------------------------------------
// upgrade_score — §5.3 economy and §15.3 acceptance tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn an_upgrade_burns_the_formula_cost_and_raises_the_stat_by_one() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(
        &mut context,
        &harness,
        setup.asset,
        setup.citizen_state,
        CitizenStat::Intelligence,
        71,
    )
    .await;

    let balance_before = token_balance(&mut context, setup.user_token_account).await;
    let supply_before = token_supply(&mut context, harness.utility_mint_key()).await;

    // A Pioneer starts at intelligence 1, so §5.3 puts the cost at
    // 100 × (1 + 1) = 200 atoms.
    upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence)
        .await
        .expect("an owner with a matching credit and enough tokens must succeed");

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.intelligence, 2, "§15.3 test 5: one stat, one level");
    assert_eq!(citizen.alignment, 1, "the other stats are untouched");
    assert_eq!(citizen.compute, 1);
    assert_eq!(citizen.insight_training_credits, 0, "§15.3 test 11: exactly one credit consumed");

    // §15.3 test 10: the full cost is burned. The balance dropping only proves
    // the tokens left the account; the supply dropping proves they were burned
    // rather than transferred, and §17 requires 100% of it.
    let expected_cost = BASE_TRAINING_COST * 2;
    assert_eq!(balance_before - token_balance(&mut context, setup.user_token_account).await, expected_cost);
    assert_eq!(
        supply_before - token_supply(&mut context, harness.utility_mint_key()).await,
        expected_cost,
        "100% of the training payment must be burned"
    );
}

#[tokio::test]
async fn the_cost_rises_with_the_score_so_tokens_alone_cannot_max_a_citizen() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    // Two Insight credits, so two upgrades can be compared.
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 81).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 82).await;

    // 1 → 2 costs 100 × 2, then 2 → 3 costs 100 × 3. A flat price would make
    // the two identical and §5.3's stated examples would not hold.
    let supply_before = token_supply(&mut context, harness.utility_mint_key()).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence)
        .await
        .expect("the first upgrade must succeed");
    let after_first = token_supply(&mut context, harness.utility_mint_key()).await;
    assert_eq!(supply_before - after_first, BASE_TRAINING_COST * 2);

    // Same instruction as the upgrade above, so it needs a fresh blockhash.
    advance(&mut context, &harness).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence)
        .await
        .expect("the second upgrade must succeed");
    let after_second = token_supply(&mut context, harness.utility_mint_key()).await;
    assert_eq!(after_first - after_second, BASE_TRAINING_COST * 3);

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.intelligence, 3);
    assert_eq!(citizen.tier_of(CitizenStat::Intelligence), 1, "§7: Tier 1 starts at 3");
    assert_eq!(citizen.insight_training_credits, 0);
    assert_eq!(
        supply_before - after_second,
        BASE_TRAINING_COST * 2 + BASE_TRAINING_COST * 3
    );
}

#[tokio::test]
async fn an_upgrade_without_a_matching_credit_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    // §15.3 test 4. Registration grants no credits, so nothing has been earned.
    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::InsufficientTrainingCredits);

    // §5.3: credits are stat-specific. A Bond credit cannot pay for Insight, so
    // after claiming only Bond the Insight upgrade must still be refused. This
    // is byte-identical to the attempt above, hence the fresh blockhash.
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Alignment, 91).await;
    advance(&mut context, &harness).await;
    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::InsufficientTrainingCredits);

    // And the Bond credit is still there, unconsumed by the refused upgrade.
    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.bond_training_credits, 1);
    assert_eq!(citizen.intelligence, 1, "no score moved");

    // The matching upgrade does work, which is what proves the refusal above was
    // about the credit kind and not about credits in general.
    upgrade(&mut context, &harness, &setup, CitizenStat::Alignment)
        .await
        .expect("a Bond credit must pay for a Bond upgrade");
    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.alignment, 2);
}

#[tokio::test]
async fn an_upgrade_is_refused_before_the_utility_mint_is_configured() {
    let (mut context, harness) = start().await;
    // Initialized but `set_utility_mint` never ran.
    initialize(&mut context, &harness).await;
    let asset = install_member(&mut context, &harness);
    send(
        &mut context,
        register_instruction(&harness, asset, harness.holder_key(), CitizenRole::Pioneer as u8),
        &[&harness.holder],
    )
    .await
    .expect("registration does not need the token");
    let citizen_state = harness.citizen_pda(&asset).0;
    claim_credit(&mut context, &harness, asset, citizen_state, CitizenStat::Intelligence, 101).await;

    let user_token_account = Pubkey::new_unique();
    context.set_account(
        &user_token_account,
        &token_account(&harness.utility_mint_key(), &harness.holder_key(), 1_000_000),
    );

    // §15.3 test 4 of §15.4: upgrade is disabled before the mint is configured,
    // so a district can never be upgraded against an unbound token.
    let result = send(
        &mut context,
        upgrade_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            harness.utility_mint_key(),
            user_token_account,
            CitizenStat::Intelligence as u8,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::UtilityMintNotSet);
    assert_eq!(read_citizen(&mut context, citizen_state).await.intelligence, 1);
    assert_eq!(read_citizen(&mut context, citizen_state).await.insight_training_credits, 1);
}

#[tokio::test]
async fn refuses_a_foreign_mint_even_when_it_is_burnable() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 111).await;

    // A second mint the holder controls, holding a real balance. Burning it
    // would succeed as far as SPL Token is concerned, which is exactly why the
    // program has to compare the mint against the bound one first.
    let foreign_mint = Keypair::new();
    context.set_account(&foreign_mint.pubkey(), &mint_account(&context.payer.pubkey(), TOKEN_SUPPLY));
    let foreign_account = Pubkey::new_unique();
    context.set_account(
        &foreign_account,
        &token_account(&foreign_mint.pubkey(), &harness.holder_key(), 1_000_000),
    );

    // Against the bound mint in the instruction but a foreign token account.
    let result = send(
        &mut context,
        upgrade_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.holder_key(),
            harness.utility_mint_key(),
            foreign_account,
            CitizenStat::Intelligence as u8,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidUtilityMint);

    // And with the foreign mint named outright.
    let result = send(
        &mut context,
        upgrade_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.holder_key(),
            foreign_mint.pubkey(),
            setup.user_token_account,
            CitizenStat::Intelligence as u8,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidUtilityMint);

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.intelligence, 1, "no score moved");
    assert_eq!(citizen.insight_training_credits, 1, "no credit consumed");
    assert_eq!(
        token_supply(&mut context, foreign_mint.pubkey()).await,
        TOKEN_SUPPLY,
        "the foreign mint must not have been burned"
    );
    assert_eq!(
        token_supply(&mut context, harness.utility_mint_key()).await,
        TOKEN_SUPPLY,
        "nor the real one"
    );
}

#[tokio::test]
async fn refuses_a_token_account_belonging_to_somebody_else() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 121).await;

    // The impostor holds a real balance of the real token. Burning somebody
    // else's tokens to raise your own citizen's score has to be refused.
    let impostor_account = Pubkey::new_unique();
    context.set_account(
        &impostor_account,
        &token_account(&harness.utility_mint_key(), &harness.impostor_key(), 1_000_000),
    );

    let result = send(
        &mut context,
        upgrade_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.holder_key(),
            harness.utility_mint_key(),
            impostor_account,
            CitizenStat::Intelligence as u8,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::NotOwner);

    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.intelligence, 1);
    assert_eq!(
        token_balance(&mut context, impostor_account).await,
        1_000_000,
        "the impostor's balance must be untouched"
    );
}

#[tokio::test]
async fn refuses_to_raise_a_stat_that_is_already_at_the_maximum() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    // Drive the score to STAT_MAX through a fixture, because reaching it by
    // instruction would take nine claims and nine upgrades.
    let mut citizen = citizen_fixture(&harness, setup.asset, CitizenRole::Pioneer);
    citizen.intelligence = STAT_MAX;
    citizen.insight_training_credits = 1;
    install_citizen(&mut context, setup.citizen_state, &citizen);

    // §15.3 test 13.
    let supply_before = token_supply(&mut context, harness.utility_mint_key()).await;
    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::MaxScore);

    let after = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(after.intelligence, STAT_MAX, "the score must not wrap to 0");
    assert_eq!(after.insight_training_credits, 1, "the credit must not be consumed");
    assert_eq!(
        token_supply(&mut context, harness.utility_mint_key()).await,
        supply_before,
        "a refused upgrade must not burn anything"
    );
    assert_eq!(after.tier_of(CitizenStat::Intelligence), 3, "§7: Tier 3 is 10");

    // A different stat of the same citizen is still trainable, so the refusal is
    // about this stat and not about the citizen.
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Compute, 131).await;
    upgrade(&mut context, &harness, &setup, CitizenStat::Compute)
        .await
        .expect("Craft is not maxed");
    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.compute, 2);
}

#[tokio::test]
async fn refuses_a_balance_that_cannot_cover_the_cost() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    // Enough for a 100 atom upgrade, not for the 200 this one actually costs.
    let setup = setup_training(&mut context, &harness, BASE_TRAINING_COST).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 141).await;

    // §15.3 test 9: the cost is computed in atoms and checked, so an
    // unaffordable upgrade reports the §13 error rather than a raw token
    // program failure.
    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::InsufficientTokenBalance);

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.intelligence, 1);
    assert_eq!(citizen.insight_training_credits, 1, "the credit must survive a refused burn");
    assert_eq!(
        token_balance(&mut context, setup.user_token_account).await,
        BASE_TRAINING_COST
    );
}

#[tokio::test]
async fn refuses_an_unknown_stat_index() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 151).await;

    for stat_index in [3u8, 9, 255] {
        let result = send(
            &mut context,
            upgrade_instruction(
                &harness,
                setup.asset,
                setup.citizen_state,
                harness.holder_key(),
                harness.utility_mint_key(),
                setup.user_token_account,
                stat_index,
            ),
            &[&harness.holder],
        )
        .await;
        expect_error_code(result, DistrictError::InvalidStat);
    }

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.insight_training_credits, 1);
    assert_eq!((citizen.intelligence, citizen.alignment, citizen.compute), (1, 1, 1));
}

#[tokio::test]
async fn refuses_to_upgrade_a_citizen_somebody_else_owns() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 161).await;

    // The impostor signs and points at the holder's citizen. Ownership is read
    // from the Core asset on every upgrade, not from stored state.
    let impostor_account = Pubkey::new_unique();
    context.set_account(
        &impostor_account,
        &token_account(&harness.utility_mint_key(), &harness.impostor_key(), 1_000_000),
    );
    let result = send(
        &mut context,
        upgrade_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.impostor_key(),
            harness.utility_mint_key(),
            impostor_account,
            CitizenStat::Intelligence as u8,
        ),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::NotOwner);
    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.intelligence, 1);
}

#[tokio::test]
async fn a_transferred_citizen_can_only_be_upgraded_by_the_new_owner() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;

    // §15.3 test 14. The Core asset is rewritten to name the successor as owner,
    // which is what a transfer does. `CitizenState` stores no owner, so there is
    // nothing to migrate — and the old owner must lose access immediately.
    install_asset(
        &mut context,
        &harness,
        setup.asset,
        core_asset(&harness.successor_key(), &harness.collection_key()),
    );

    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::NotOwner);

    // The new owner still needs a credit of their own; credits belong to the
    // citizen, not to whoever registered it, and they were never granted here.
    let (receipt, _) = harness.claim_receipt_pda(&setup.asset, 171, 1);
    send(
        &mut context,
        claim_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.successor_key(),
            harness.mission_authority_key(),
            MissionClaimArgs {
                stat: CitizenStat::Intelligence as u8,
                mission_id: 171,
                season_id: 1,
                nonce: 1,
                expires_at: NOW + AN_HOUR,
            },
            receipt,
        ),
        &[&harness.successor, &harness.mission_authority],
    )
    .await
    .expect("the new owner must be able to claim for their own citizen");

    let successor_account = Pubkey::new_unique();
    context.set_account(
        &successor_account,
        &token_account(&harness.utility_mint_key(), &harness.successor_key(), 1_000_000),
    );
    send(
        &mut context,
        upgrade_instruction(
            &harness,
            setup.asset,
            setup.citizen_state,
            harness.successor_key(),
            harness.utility_mint_key(),
            successor_account,
            CitizenStat::Intelligence as u8,
        ),
        &[&harness.successor],
    )
    .await
    .expect("the new owner must be able to train the citizen they now hold");

    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.intelligence, 2);
}

#[tokio::test]
async fn a_citizen_from_a_foreign_collection_cannot_be_upgraded() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness, 1_000_000).await;
    claim_credit(&mut context, &harness, setup.asset, setup.citizen_state, CitizenStat::Intelligence, 181).await;

    // §15.3 test 7 is listed under Training, not just under Mint: collection
    // membership is re-checked on every upgrade, so an asset that left the
    // collection cannot keep being trained.
    install_asset(
        &mut context,
        &harness,
        setup.asset,
        core_asset(&harness.holder_key(), &Pubkey::new_unique()),
    );

    let result = upgrade(&mut context, &harness, &setup, CitizenStat::Intelligence).await;
    expect_error_code(result, DistrictError::InvalidCollection);
    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.intelligence, 1);
    assert_eq!(read_citizen(&mut context, setup.citizen_state).await.insight_training_credits, 1);
}

// ---------------------------------------------------------------------------
// propose_admin / accept_admin
// ---------------------------------------------------------------------------

#[tokio::test]
async fn admin_moves_only_through_propose_then_accept() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    send(
        &mut context,
        propose_admin_instruction(&harness, harness.successor_key()),
        &[&harness.admin],
    )
    .await
    .expect("the admin must be able to propose a successor");
    assert_eq!(read_config(&mut context, &harness).await.pending_admin, harness.successor_key());
    assert_eq!(read_config(&mut context, &harness).await.admin, harness.admin_key());

    // Proposing is not enough: until the successor accepts, the old admin is
    // still the admin, so a typo cannot hand the district to a dead address.
    send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), true),
        &[&harness.admin],
    )
    .await
    .expect("the current admin keeps authority until acceptance");
    send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), false),
        &[&harness.admin],
    )
    .await
    .expect("and can still resume");

    // Somebody else cannot accept on the successor's behalf. The impostor does
    // sign here, so what stops them is the constraint that `new_admin` equals
    // the pending admin — which is worth knowing about, because Anchor evaluates
    // account constraints *before* the runtime verifies signatures against them.
    // An account that is not signed is therefore reported as `Unauthorized` from
    // the constraint, not as `MissingRequiredSignature`.
    advance(&mut context, &harness).await;
    let result = send(
        &mut context,
        accept_admin_instruction(&harness, harness.impostor_key()),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);
    assert_eq!(read_config(&mut context, &harness).await.admin, harness.admin_key());

    send(
        &mut context,
        accept_admin_instruction(&harness, harness.successor_key()),
        &[&harness.successor],
    )
    .await
    .expect("the proposed successor must be able to accept");

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.admin, harness.successor_key());
    assert_eq!(config.pending_admin, Pubkey::default(), "the proposal is cleared");

    // The old admin has no authority any more, and the new one does.
    let result = send(
        &mut context,
        set_paused_instruction(&harness, harness.admin_key(), true),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);

    send(
        &mut context,
        set_paused_instruction(&harness, harness.successor_key(), true),
        &[&harness.successor],
    )
    .await
    .expect("the new admin must have authority");
    assert!(read_config(&mut context, &harness).await.is_paused);
}

#[tokio::test]
async fn accepting_without_a_pending_proposal_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // `pending_admin` is the default pubkey, so the constraint that the signer
    // equals it cannot be satisfied by any real keypair.
    let result = send(
        &mut context,
        accept_admin_instruction(&harness, harness.successor_key()),
        &[&harness.successor],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);
    assert_eq!(read_config(&mut context, &harness).await.admin, harness.admin_key());
}

#[tokio::test]
async fn proposing_yourself_or_nobody_is_refused() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    // Proposing yourself would write a pending_admin that accept_admin could
    // then use to emit a transfer that never happened.
    let result = send(
        &mut context,
        propose_admin_instruction(&harness, harness.admin_key()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);

    // And an empty proposal would let anyone satisfy accept_admin's signer check
    // by passing the default pubkey.
    let result = send(
        &mut context,
        propose_admin_instruction(&harness, Pubkey::default()),
        &[&harness.admin],
    )
    .await;
    expect_error_code(result, DistrictError::Unauthorized);

    assert_eq!(read_config(&mut context, &harness).await.pending_admin, Pubkey::default());
}

#[tokio::test]
async fn only_the_admin_can_propose_a_successor() {
    let (mut context, harness) = start().await;
    bootstrap(&mut context, &harness).await;

    let mut instruction = propose_admin_instruction(&harness, harness.impostor_key());
    for meta in instruction.accounts.iter_mut() {
        if meta.pubkey == harness.admin_key() {
            meta.pubkey = harness.impostor_key();
            meta.is_signer = true;
        }
    }
    let result = send(&mut context, instruction, &[&harness.impostor]).await;
    expect_error_code(result, DistrictError::Unauthorized);
    assert_eq!(read_config(&mut context, &harness).await.pending_admin, Pubkey::default());
}

// ---------------------------------------------------------------------------
// parity with the TypeScript clients
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_stat_and_role_models_stay_in_parity_with_the_typescript_clients() {
    // These values are duplicated in `packages/chain-client` and
    // `packages/content`, whose own tests grep this crate's source. Asserting
    // them here too means a change to one side without the other fails on both.
    assert_eq!(STAT_MAX, 10, "SPEC §7: Maximum score: 10");
    assert_eq!((TIER_1_SCORE, TIER_2_SCORE, TIER_3_SCORE), (3, 6, 10));
    assert_eq!(TIER_3_SCORE, STAT_MAX);

    assert_eq!(CitizenStat::Intelligence as u8, 0);
    assert_eq!(CitizenStat::Alignment as u8, 1);
    assert_eq!(CitizenStat::Compute as u8, 2);

    // §7: the internal code names are fixed, the public labels are the ones the
    // UI is allowed to show.
    assert_eq!(CitizenStat::Intelligence.public_label(), "Insight");
    assert_eq!(CitizenStat::Alignment.public_label(), "Bond");
    assert_eq!(CitizenStat::Compute.public_label(), "Craft");

    assert_eq!(ROLE_TEMPLATES.len(), ROLE_COUNT);
    assert_eq!(ROLE_COUNT, 7, "SPEC §8 Phase A: Seven role registry");
    assert_eq!(CitizenRole::Pioneer as u8, 0);
    assert_eq!(CitizenRole::Mentor as u8, 6);

    // §5.3's own worked examples, so a change to the formula fails here.
    assert_eq!(district::state::training_cost_atoms(BASE_TRAINING_COST, 1).unwrap(), 200);
    assert_eq!(district::state::training_cost_atoms(BASE_TRAINING_COST, 8).unwrap(), 900);
    assert_eq!(district::state::training_cost_atoms(BASE_TRAINING_COST, 9).unwrap(), 1_000);

    // The approved-template address is part of the client contract too.
    assert_eq!(
        approved_template_address(APPROVED_TEMPLATE_ID),
        Pubkey::find_program_address(
            &[b"approved_template", &APPROVED_TEMPLATE_ID.to_le_bytes()],
            &district::ID
        )
        .0
    );
}
