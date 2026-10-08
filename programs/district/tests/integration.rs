//! End-to-end instruction tests for the district program.
//!
//! These run against `solana-program-test`, which executes the real program
//! logic inside a simulated bank: account constraints, PDA derivation, borsh
//! serialization, CPI to SPL Token and event emission all really happen. No
//! validator, no BPF build and no Anchor CLI are involved, so plain
//! `cargo test` covers the instruction path.
//!
//! The processor is the `entry` function that Anchor's `#[program]` macro
//! generates — `pub fn entry(&Pubkey, &[AccountInfo], &[u8]) -> ProgramResult`,
//! exactly the signature `ProgramTest::new` asks for.
//!
//! Scope: behaviour that only shows up once a whole instruction executes. That
//! a forged asset cannot become a citizen, that a foreign mint cannot be burned
//! for score, and that only the authority can pause. Byte-level parsing of the
//! Metaplex Core layout is covered separately by `src/mpl_core.rs`.
//!
//! Run with `pnpm program:test`, which is also what `[scripts].test` in
//! `programs/Anchor.toml` and the CI `programs` job execute.

use anchor_lang::{
    solana_program::{
        entrypoint::ProgramResult, instruction::Instruction, program_pack::Pack, pubkey::Pubkey,
        system_program,
    },
    AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use anchor_spl::token;
use district::{
    accounts, errors::DistrictError,
    events::{CitizenRegistered, DistrictPausedChanged, StatTrained},
    instruction,
    mpl_core::{self, MPL_CORE_PROGRAM_ID},
    state::{CitizenStat, CitizenState, DistrictConfig, INITIAL_TRAINING_CREDITS, STAT_MAX},
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

const BURN_AMOUNT: u64 = 100;
const TOKEN_DECIMALS: u8 = 9;
const TOKEN_SUPPLY: u64 = 1_000_000;

/// The transaction logs on success, or the transport error on failure.
type SendResult = Result<Vec<String>, TransportError>;

thread_local! {
    /// Program logs of the most recent `send`, kept so a failure can show what
    /// the program actually said instead of only a numeric error code.
    static LAST_LOGS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn dump_last_logs(what: &str) {
    LAST_LOGS.with(|logs| {
        let logs = logs.borrow();
        println!("--- program logs for {what} ({} lines) ---", logs.len());
        for line in logs.iter() {
            println!("| {line}");
        }
        println!("--- end of logs for {what} ---");
    });
}

// ---------------------------------------------------------------------------
// harness
//
// Keys and addresses live in `Harness`, which is never borrowed mutably, while
// the bank lives in `ProgramTestContext`. Splitting them keeps every helper
// `(&mut ProgramTestContext, &Harness)` and avoids borrowing one struct both
// ways in a single call.
// ---------------------------------------------------------------------------

struct Harness {
    authority: Keypair,
    holder: Keypair,
    impostor: Keypair,
    /// The utility token mint the district burns. A keypair so the fixture can
    /// be installed at a known address.
    utility_mint: Keypair,
    config: Pubkey,
    collection_mint: Pubkey,
    /// Stand-in for the Metaplex Core program. The district program only ever
    /// compares `asset.owner` against the account passed as `mpl_core_program`,
    /// so this address does not have to be executable for the ownership
    /// constraint to be meaningful.
    mpl_core: Pubkey,
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

    fn authority_key(&self) -> Pubkey {
        self.authority.pubkey()
    }

    fn holder_key(&self) -> Pubkey {
        self.holder.pubkey()
    }

    fn impostor_key(&self) -> Pubkey {
        self.impostor.pubkey()
    }

    fn utility_mint_key(&self) -> Pubkey {
        self.utility_mint.pubkey()
    }

    fn citizen_pda(&self, asset: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"citizen_state", asset.as_ref()], &district::ID)
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
    // Registration writes a PDA and emits an event; give it headroom so tests
    // fail on logic rather than on the default 200k per-instruction budget.
    program_test.set_compute_max_units(1_400_000);
    let mut context = program_test.start_with_context().await;

    let harness = Harness {
        authority: Keypair::new(),
        holder: Keypair::new(),
        impostor: Keypair::new(),
        utility_mint: Keypair::new(),
        config: Pubkey::find_program_address(&[b"district_config"], &district::ID).0,
        collection_mint: Pubkey::new_unique(),
        mpl_core: MPL_CORE_PROGRAM_ID,
    };

    // Anchor's `init` constraint funds the new account from the account named
    // as `payer`, not from the transaction fee payer. `InitializeDistrict`
    // declares `payer = authority` and `RegisterCitizen` declares
    // `payer = owner`, so both keypairs need their own rent balance or the
    // system program CPI fails with `insufficient lamports 0, need 1712160`.
    for account in [
        harness.authority_key(),
        harness.holder_key(),
        harness.impostor_key(),
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

    // `process_transaction_with_metadata` comes back with empty `log_messages`
    // in banks mode, so the logs are taken from a simulation of the same
    // transaction. Simulating does not commit, and it runs against the same bank
    // state the execution then sees, so the outcome it reports matches.
    let simulated = context.banks_client.simulate_transaction(transaction.clone()).await?;
    println!(
        "simulate: simulation_details={} result={:?} units={:?}",
        simulated.simulation_details.is_some(),
        simulated.result.as_ref().map(|r| r.is_ok()),
        simulated.simulation_details.as_ref().map(|d| d.units_consumed),
    );
    let logs = simulated
        .simulation_details
        .map(|details| details.logs)
        .unwrap_or_default();
    println!("simulate: {} log lines", logs.len());
    for line in logs.iter().take(25) {
        println!("simulate| {line}");
    }
    LAST_LOGS.with(|slot| *slot.borrow_mut() = logs.clone());

    let executed = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await?;

    // Execution is authoritative; the simulation is only read for its logs.
    match executed.result {
        Ok(()) => Ok(logs),
        Err(transaction_error) => Err(TransportError::TransactionError(transaction_error)),
    }
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
// fixtures
// ---------------------------------------------------------------------------

fn initialize_instruction(harness: &Harness, burn_amount: u64) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::InitializeDistrict {
            config: harness.config_key(),
            utility_mint: harness.utility_mint_key(),
            collection_mint: harness.collection_key(),
            authority: harness.authority_key(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::InitializeDistrict { burn_amount }.data(),
    }
}

async fn initialize(context: &mut ProgramTestContext, harness: &Harness) {
    let instruction = initialize_instruction(harness, BURN_AMOUNT);
    if let Err(error) = send(context, instruction, &[&harness.authority]).await {
        dump_last_logs("initialize_district");
        panic!("initialize_district must succeed, got {error}");
    }
}

async fn read_config(context: &mut ProgramTestContext, harness: &Harness) -> DistrictConfig {
    let account = context
        .banks_client
        .get_account(harness.config_key())
        .await
        .expect("a transport error")
        .expect("the district config must exist");
    DistrictConfig::try_deserialize(&mut &account.data[..]).expect("the config must deserialize")
}

async fn read_citizen(
    context: &mut ProgramTestContext,
    citizen_state: Pubkey,
) -> CitizenState {
    let account = context
        .banks_client
        .get_account(citizen_state)
        .await
        .expect("a transport error")
        .expect("the citizen state must exist");
    CitizenState::try_deserialize(&mut &account.data[..]).expect("the state must deserialize")
}

/// Build the bytes of a Metaplex Core `AssetV1` account, using the same offsets
/// the unit tests in `src/mpl_core.rs` assert.
fn core_asset(owner: &Pubkey, collection: &Pubkey) -> Vec<u8> {
    let mut data = Vec::new();
    data.push(mpl_core::KEY_ASSET_V1);
    data.extend_from_slice(owner.as_ref());
    data.push(mpl_core::UPDATE_AUTHORITY_COLLECTION);
    data.extend_from_slice(collection.as_ref());
    for text in ["Citizen #13", "https://bas.example/citizen/13.json"] {
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
fn install_account(context: &mut ProgramTestContext, address: Pubkey, data: Vec<u8>, owner: Pubkey) {
    // `ProgramTestContext::set_account` takes `&AccountSharedData`, whose data
    // setter is private; the public route is `From<solana_sdk::account::Account>`.
    let lamports = Rent::default().minimum_balance(data.len().max(1));
    let shared = AccountSharedData::from(solana_sdk::account::Account {
        lamports,
        data,
        owner,
        executable: false,
        rent_epoch: u64::MAX,
    });
    context.set_account(&address, &shared);
}

fn register_instruction(
    harness: &Harness,
    asset: Pubkey,
    citizen_state: Pubkey,
    owner: Pubkey,
    stats: (u8, u8, u8),
) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::RegisterCitizen {
            config: harness.config_key(),
            asset,
            mpl_core_program: harness.mpl_core_key(),
            citizen_state,
            owner,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::RegisterCitizen {
            initial_int: stats.0,
            initial_aln: stats.1,
            initial_cmp: stats.2,
        }
        .data(),
    }
}

/// Register a genuine collection member held by `harness.holder`.
async fn register_member(
    context: &mut ProgramTestContext,
    harness: &Harness,
) -> (Pubkey, Pubkey) {
    let asset = Pubkey::new_unique();
    install_asset(
        context,
        harness,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
    );
    let (citizen_state, _) = harness.citizen_pda(&asset);
    let holder = harness.holder_key();

    let logs = send(
        context,
        register_instruction(harness, asset, citizen_state, holder, (1, 2, 3)),
        &[&harness.holder],
    )
    .await
    .expect("registering a genuine collection member must succeed");

    assert!(
        logs.iter().any(|line| line.contains("Instruction: RegisterCitizen")),
        "the program log should name the handler, got {logs:?}"
    );
    (asset, citizen_state)
}

/// A mint fixture. The mint's own address is not part of `spl_token::state::Mint`,
/// so it is not a parameter here.
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

struct Training {
    citizen_state: Pubkey,
    user_token_account: Pubkey,
}

/// Register a citizen and give the holder a utility token balance to burn.
async fn setup_training(context: &mut ProgramTestContext, harness: &Harness) -> Training {
    let (_, citizen_state) = register_member(context, harness).await;

    let user_token_account = Pubkey::new_unique();
    let utility_mint = harness.utility_mint_key();
    let payer = context.payer.pubkey();
    let holder = harness.holder_key();

    context.set_account(
        &utility_mint,
        &mint_account(&payer, TOKEN_SUPPLY),
    );
    context.set_account(
        &user_token_account,
        &token_account(&utility_mint, &holder, BURN_AMOUNT * 10),
    );

    Training {
        citizen_state,
        user_token_account,
    }
}

fn train_instruction(
    harness: &Harness,
    setup: &Training,
    stat: CitizenStat,
    utility_mint: Pubkey,
    user_token_account: Pubkey,
) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::TrainStat {
            config: harness.config_key(),
            citizen_state: setup.citizen_state,
            owner: harness.holder_key(),
            utility_mint,
            user_token_account,
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::TrainStat { stat }.data(),
    }
}

fn set_paused_instruction(harness: &Harness, authority: Pubkey, paused: bool) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts::SetPaused {
            config: harness.config_key(),
            authority,
        }
        .to_account_metas(None),
        data: instruction::SetPaused { paused }.data(),
    }
}

async fn token_balance(
    context: &mut ProgramTestContext,
    account: Pubkey,
) -> u64 {
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

/// The base64 payloads of `Program data:` log lines, which is how Anchor emits
/// events, keeping only those whose discriminator matches.
fn emitted_events(logs: &[String], discriminator: [u8; 8]) -> Vec<Vec<u8>> {
    logs.iter()
        .filter_map(|line| {
            let payload = line.split("Program data: ").nth(1)?;
            decode_base64(payload)
        })
        .filter(|bytes| bytes.starts_with(&discriminator))
        .map(|bytes| bytes[8..].to_vec())
        .collect()
}

/// A dependency-free base64 decoder for the one helper that needs it.
fn decode_base64(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let symbols: Vec<u32> = input
        .bytes()
        .filter(|&byte| byte != b'=' && !byte.is_ascii_whitespace())
        .map(|byte| ALPHABET.iter().position(|&candidate| candidate == byte).map(|index| index as u32))
        .collect::<Option<_>>()?;

    let mut output = Vec::with_capacity(symbols.len() * 3 / 4);
    for chunk in symbols.chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
        let bits = chunk.iter().fold(0u32, |accumulator, symbol| (accumulator << 6) | symbol);
        // A full group yields 3 bytes; a trailing group of n symbols yields n-1.
        for index in 0..chunk.len() - 1 {
            output.push((bits >> (16 - 8 * index)) as u8);
        }
    }
    Some(output)
}

// ---------------------------------------------------------------------------
// initialize_district
// ---------------------------------------------------------------------------

#[tokio::test]
async fn initialize_writes_the_config_pda() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let config = read_config(&mut context, &harness).await;
    assert_eq!(config.authority, harness.authority_key());
    assert_eq!(config.utility_mint, harness.utility_mint_key());
    assert_eq!(config.collection_mint, harness.collection_key());
    assert_eq!(config.burn_amount_required, BURN_AMOUNT);
    assert_eq!(config.total_registered_citizens, 0);
    assert!(!config.is_paused, "a fresh district must not be paused");

    let (_, bump) = Pubkey::find_program_address(&[b"district_config"], &district::ID);
    assert_eq!(config.bump, bump);
}

// ---------------------------------------------------------------------------
// set_paused
// ---------------------------------------------------------------------------

#[tokio::test]
async fn only_the_authority_can_pause() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let result = send(
        &mut context,
        set_paused_instruction(&harness, harness.impostor_key(), true),
        &[&harness.impostor],
    )
    .await;
    expect_error_code(result, DistrictError::UnauthorizedAuthority);

    assert!(
        !read_config(&mut context, &harness).await.is_paused,
        "a rejected pause must not change the config"
    );
}

#[tokio::test]
async fn pauses_and_resumes_and_emits_only_on_a_real_change() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let authority = harness.authority_key();

    let pause_logs = send(
        &mut context,
        set_paused_instruction(&harness, authority, true),
        &[&harness.authority],
    )
    .await
    .expect("the authority must be able to pause");
    assert!(read_config(&mut context, &harness).await.is_paused);

    let events = emitted_events(&pause_logs, DistrictPausedChanged::discriminator());
    assert_eq!(events.len(), 1, "pausing must emit exactly one event");
    let event = DistrictPausedChanged::try_from_slice(&events[0]).expect("event bytes");
    assert!(event.paused);
    assert_eq!(event.authority, authority);

    // Writing the same value again is a no-op, so it must not emit.
    let repeat_logs = send(
        &mut context,
        set_paused_instruction(&harness, authority, true),
        &[&harness.authority],
    )
    .await
    .expect("repeating paused=true must still succeed");
    assert!(
        emitted_events(&repeat_logs, DistrictPausedChanged::discriminator()).is_empty(),
        "an unchanged value must not emit DistrictPausedChanged"
    );

    let resume_logs = send(
        &mut context,
        set_paused_instruction(&harness, authority, false),
        &[&harness.authority],
    )
    .await
    .expect("the authority must be able to resume");
    assert!(!read_config(&mut context, &harness).await.is_paused);

    let events = emitted_events(&resume_logs, DistrictPausedChanged::discriminator());
    assert_eq!(events.len(), 1);
    assert!(
        !DistrictPausedChanged::try_from_slice(&events[0])
            .expect("event bytes")
            .paused
    );
}

#[tokio::test]
async fn pausing_blocks_registration_and_training() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness).await;

    send(
        &mut context,
        set_paused_instruction(&harness, harness.authority_key(), true),
        &[&harness.authority],
    )
    .await
    .expect("the authority must be able to pause");

    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
    );
    let (citizen_state, _) = harness.citizen_pda(&asset);

    let result = send(
        &mut context,
        register_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            (1, 1, 1),
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::ProgramPaused);

    let result = send(
        &mut context,
        train_instruction(
            &harness,
            &setup,
            CitizenStat::Intelligence,
            harness.utility_mint_key(),
            setup.user_token_account,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::ProgramPaused);

    assert_eq!(
        read_config(&mut context, &harness).await.total_registered_citizens,
        1,
        "only the registration from setup_training counts"
    );
}

// ---------------------------------------------------------------------------
// register_citizen — the collection membership gate
// ---------------------------------------------------------------------------

#[tokio::test]
async fn registers_a_genuine_collection_member() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let (asset, citizen_state) = register_member(&mut context, &harness).await;

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(citizen.asset, asset);
    assert_eq!(citizen.owner, harness.holder_key());
    assert_eq!(citizen.intelligence, 1);
    assert_eq!(citizen.alignment, 2);
    assert_eq!(citizen.composure, 3);
    assert_eq!(citizen.training_credits, INITIAL_TRAINING_CREDITS);
    assert_eq!(citizen.total_burns, 0);
    assert_eq!(citizen.bump, harness.citizen_pda(&asset).1);

    assert_eq!(
        read_config(&mut context, &harness).await.total_registered_citizens,
        1
    );
}

#[tokio::test]
async fn clamps_stats_that_exceed_the_maximum() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
    );
    let (citizen_state, _) = harness.citizen_pda(&asset);

    send(
        &mut context,
        register_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            (250, 20, 99),
        ),
        &[&harness.holder],
    )
    .await
    .expect("registration must succeed");

    let citizen = read_citizen(&mut context, citizen_state).await;
    assert_eq!(citizen.intelligence, STAT_MAX, "250 must clamp to STAT_MAX");
    assert_eq!(citizen.alignment, STAT_MAX, "20 is already the maximum");
    assert_eq!(citizen.composure, STAT_MAX, "99 must clamp to STAT_MAX");
}

#[tokio::test]
async fn rejects_an_asset_from_a_foreign_collection() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let asset = Pubkey::new_unique();
    let foreign_collection = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset(&harness.holder_key(), &foreign_collection),
    );
    let (citizen_state, _) = harness.citizen_pda(&asset);

    let result = send(
        &mut context,
        register_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            (1, 1, 1),
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidCollection);

    assert!(
        context
            .banks_client
            .get_account(citizen_state)
            .await
            .expect("a transport error")
            .is_none(),
        "no citizen state may be written for a rejected asset"
    );
    assert_eq!(
        read_config(&mut context, &harness).await.total_registered_citizens,
        0
    );
}

#[tokio::test]
async fn rejects_an_asset_the_signer_does_not_own() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // The right collection, but the Core asset records somebody else as owner.
    let asset = Pubkey::new_unique();
    install_asset(
        &mut context,
        &harness,
        asset,
        core_asset(&harness.impostor_key(), &harness.collection_key()),
    );
    let (citizen_state, _) = harness.citizen_pda(&asset);

    let result = send(
        &mut context,
        register_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            (1, 1, 1),
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::NotAssetOwner);
}

#[tokio::test]
async fn rejects_accounts_that_are_not_collection_member_assets() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // A standalone asset: `UpdateAuthority::Address` instead of `Collection`.
    let mut standalone = core_asset(&harness.holder_key(), &harness.collection_key());
    standalone[mpl_core::UPDATE_AUTHORITY_TAG_OFFSET] = 1;

    // A compressed asset, and a collection account passed where an asset is
    // expected.
    let mut compressed = core_asset(&harness.holder_key(), &harness.collection_key());
    compressed[0] = mpl_core::KEY_HASHED_ASSET_V1;

    let mut collection_account = core_asset(&harness.holder_key(), &harness.collection_key());
    collection_account[0] = mpl_core::KEY_COLLECTION_V1;

    for (label, data, expected) in [
        (
            "a standalone asset",
            standalone,
            DistrictError::AssetNotInACollection,
        ),
        ("a compressed asset", compressed, DistrictError::NotACoreAsset),
        (
            "a collection account",
            collection_account,
            DistrictError::NotACoreAsset,
        ),
    ] {
        let asset = Pubkey::new_unique();
        install_asset(&mut context, &harness, asset, data);
        let (citizen_state, _) = harness.citizen_pda(&asset);

        let result = send(
            &mut context,
            register_instruction(
                &harness,
                asset,
                citizen_state,
                harness.holder_key(),
                (1, 1, 1),
            ),
            &[&harness.holder],
        )
        .await;
        assert_eq!(
            custom_error_code(&result.expect_err("must fail")),
            u32::from(expected),
            "{label} must be rejected with {:?}",
            expected
        );
    }
}

#[tokio::test]
async fn rejects_an_asset_that_is_not_owned_by_the_core_program() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    // The bytes describe a perfect collection member, but the account is owned
    // by the holder instead of Metaplex Core, so Anchor's `owner` constraint
    // must reject it before the parser is ever reached.
    let asset = Pubkey::new_unique();
    install_account(
        &mut context,
        asset,
        core_asset(&harness.holder_key(), &harness.collection_key()),
        harness.holder_key(),
    );
    let (citizen_state, _) = harness.citizen_pda(&asset);

    let result = send(
        &mut context,
        register_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            (1, 1, 1),
        ),
        &[&harness.holder],
    )
    .await;
    let failure = result.expect_err("a self-owned account must not pass as a Core asset");

    assert_eq!(
        custom_error_code(&failure),
        u32::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram),
        "expected AccountOwnedByWrongProgram (3007), got {failure}"
    );
}

#[tokio::test]
async fn cannot_register_the_same_asset_twice() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let (asset, citizen_state) = register_member(&mut context, &harness).await;
    let result = send(
        &mut context,
        register_instruction(
            &harness,
            asset,
            citizen_state,
            harness.holder_key(),
            (1, 1, 1),
        ),
        &[&harness.holder],
    )
    .await;
    let failure = result.expect_err("the citizen PDA already exists");

    // `TransportError`'s Display only prints `custom program error: 0x...`, so
    // the code has to be compared rather than the message searched.
    assert_eq!(
        custom_error_code(&failure),
        u32::from(anchor_lang::error::ErrorCode::AccountAlreadyInUse),
        "expected AccountAlreadyInUse (3006), got {failure}"
    );
    assert_eq!(
        read_config(&mut context, &harness).await.total_registered_citizens,
        1
    );
}

#[tokio::test]
async fn emits_citizen_registered_with_the_running_total() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;

    let mut totals = Vec::new();
    for _ in 0..3 {
        let asset = Pubkey::new_unique();
        install_asset(
            &mut context,
            &harness,
            asset,
            core_asset(&harness.holder_key(), &harness.collection_key()),
        );
        let (citizen_state, _) = harness.citizen_pda(&asset);

        let logs = send(
            &mut context,
            register_instruction(
                &harness,
                asset,
                citizen_state,
                harness.holder_key(),
                (1, 1, 1),
            ),
            &[&harness.holder],
        )
        .await
        .expect("each registration must succeed");

        let events = emitted_events(&logs, CitizenRegistered::discriminator());
        assert_eq!(events.len(), 1);
        let event = CitizenRegistered::try_from_slice(&events[0]).expect("event bytes");
        assert_eq!(event.asset, asset);
        assert_eq!(event.owner, harness.holder_key());
        totals.push(event.total_registered_citizens);
    }

    assert_eq!(totals, vec![1, 2, 3]);
    assert_eq!(
        read_config(&mut context, &harness).await.total_registered_citizens,
        3
    );
}

// ---------------------------------------------------------------------------
// train_stat — the token burn gate
// ---------------------------------------------------------------------------

#[tokio::test]
async fn burns_the_utility_token_and_raises_the_stat() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness).await;

    let balance_before = token_balance(&mut context, setup.user_token_account).await;

    let logs = send(
        &mut context,
        train_instruction(
            &harness,
            &setup,
            CitizenStat::Alignment,
            harness.utility_mint_key(),
            setup.user_token_account,
        ),
        &[&harness.holder],
    )
    .await
    .expect("training with the bound utility token must succeed");

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.alignment, 3, "registered at 2, trained once");
    assert_eq!(citizen.intelligence, 1, "the other stats are untouched");
    assert_eq!(
        citizen.training_credits,
        INITIAL_TRAINING_CREDITS - 1,
        "one credit is consumed per training"
    );
    assert_eq!(citizen.total_burns, 1);

    let balance_after = token_balance(&mut context, setup.user_token_account).await;
    assert_eq!(
        balance_before - balance_after,
        BURN_AMOUNT,
        "exactly the configured amount must be burned"
    );

    let events = emitted_events(&logs, StatTrained::discriminator());
    assert_eq!(events.len(), 1);
    let event = StatTrained::try_from_slice(&events[0]).expect("event bytes");
    assert_eq!(event.stat, CitizenStat::Alignment as u8);
    assert_eq!(event.new_score, 3);
    assert_eq!(event.tokens_burned, BURN_AMOUNT);
    assert_eq!(event.remaining_training_credits, 0);
}

#[tokio::test]
async fn refuses_a_foreign_mint_even_when_it_is_burnable() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness).await;

    // A second mint the holder controls, holding a real balance. Burning it
    // would succeed as far as SPL Token is concerned, which is exactly why the
    // program has to compare it against config.utility_mint.
    let foreign_mint = Pubkey::new_unique();
    let foreign_token_account = Pubkey::new_unique();
    let payer = context.payer.pubkey();

    context.set_account(
        &foreign_mint,
        &mint_account(&payer, TOKEN_SUPPLY),
    );
    context.set_account(
        &foreign_token_account,
        &token_account(&foreign_mint, &harness.holder_key(), BURN_AMOUNT * 10),
    );

    let result = send(
        &mut context,
        train_instruction(
            &harness,
            &setup,
            CitizenStat::Intelligence,
            foreign_mint,
            foreign_token_account,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InvalidUtilityMint);

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    assert_eq!(citizen.intelligence, 1, "the canonical score must not move");
    assert_eq!(citizen.training_credits, INITIAL_TRAINING_CREDITS);
    assert_eq!(citizen.total_burns, 0);

    assert_eq!(
        token_balance(&mut context, foreign_token_account).await,
        BURN_AMOUNT * 10,
        "the foreign balance must not be burned either"
    );
}

#[tokio::test]
async fn refuses_a_token_account_belonging_to_somebody_else() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness).await;

    let impostor_token_account = Pubkey::new_unique();
    context.set_account(
        &impostor_token_account,
        &token_account(
            &harness.utility_mint_key(),
            &harness.impostor_key(),
            BURN_AMOUNT * 10,
        ),
    );

    let result = send(
        &mut context,
        train_instruction(
            &harness,
            &setup,
            CitizenStat::Intelligence,
            harness.utility_mint_key(),
            impostor_token_account,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::UnauthorizedCitizenOwner);

    assert_eq!(
        read_citizen(&mut context, setup.citizen_state).await.intelligence,
        1
    );
    assert_eq!(
        token_balance(&mut context, impostor_token_account).await,
        BURN_AMOUNT * 10,
        "somebody else's balance must stay untouched"
    );
}

#[tokio::test]
async fn refuses_a_second_training_once_credits_run_out() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness).await;

    // Top the balance up so the failure can only come from the credit check.
    context.set_account(
        &setup.user_token_account,
        &token_account(
            &harness.utility_mint_key(),
            &harness.holder_key(),
            BURN_AMOUNT * 100,
        ),
    );

    send(
        &mut context,
        train_instruction(
            &harness,
            &setup,
            CitizenStat::Intelligence,
            harness.utility_mint_key(),
            setup.user_token_account,
        ),
        &[&harness.holder],
    )
    .await
    .expect("the first training must succeed");

    let result = send(
        &mut context,
        train_instruction(
            &harness,
            &setup,
            CitizenStat::Composure,
            harness.utility_mint_key(),
            setup.user_token_account,
        ),
        &[&harness.holder],
    )
    .await;
    expect_error_code(result, DistrictError::InsufficientTrainingCredits);

    let citizen = read_citizen(&mut context, setup.citizen_state).await;
    // Registered at (1, 2, 3): the first training raised intelligence to 2 and
    // the rejected one must leave composure at the value it was registered with.
    assert_eq!(citizen.intelligence, 2);
    assert_eq!(citizen.composure, 3, "the second stat must not move");
    assert_eq!(citizen.alignment, 2, "an untrained stat must not move either");
    assert_eq!(citizen.training_credits, 0);
    assert_eq!(citizen.total_burns, 1);
}

#[tokio::test]
async fn refuses_to_train_a_citizen_owned_by_somebody_else() {
    let (mut context, harness) = start().await;
    initialize(&mut context, &harness).await;
    let setup = setup_training(&mut context, &harness).await;

    // The impostor signs and brings a perfectly valid token account of their
    // own, so every Anchor account constraint passes and the failure can only
    // come from the `citizen.owner == owner` check in the handler. Without
    // installing this account the transaction would be rejected earlier, while
    // deserializing `Account<TokenAccount>`, and the test would pass for the
    // wrong reason.
    let impostor_token_account = Pubkey::new_unique();
    context.set_account(
        &impostor_token_account,
        &token_account(
            &harness.utility_mint_key(),
            &harness.impostor_key(),
            BURN_AMOUNT * 10,
        ),
    );

    let mut instruction = train_instruction(
        &harness,
        &setup,
        CitizenStat::Intelligence,
        harness.utility_mint_key(),
        impostor_token_account,
    );
    let holder = harness.holder_key();
    let impostor = harness.impostor_key();
    for meta in &mut instruction.accounts {
        if meta.pubkey == holder {
            meta.pubkey = impostor;
        }
    }

    let result = send(&mut context, instruction, &[&harness.impostor]).await;
    expect_error_code(result, DistrictError::UnauthorizedCitizenOwner);

    assert_eq!(
        token_balance(&mut context, impostor_token_account).await,
        BURN_AMOUNT * 10,
        "nothing may be burned from the impostor either"
    );

    assert_eq!(
        read_citizen(&mut context, setup.citizen_state).await.intelligence,
        1
    );
}

#[tokio::test]
async fn the_stat_model_stays_in_parity_with_the_typescript_clients() {
    // `packages/chain-client/test` mirrors these values into TypeScript; this
    // is the on-chain half of the same contract.
    assert_eq!(STAT_MAX, 20);
    assert_eq!(INITIAL_TRAINING_CREDITS, 1);
    assert_eq!(CitizenStat::Intelligence as u8, 0);
    assert_eq!(CitizenStat::Alignment as u8, 1);
    assert_eq!(CitizenStat::Composure as u8, 2);
}
