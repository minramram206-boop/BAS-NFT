//! Bank setup, transaction sending and error decoding.

use std::cell::Cell;

use anchor_lang::solana_program::{
    bpf_loader_upgradeable, clock::Clock, entrypoint::ProgramResult, instruction::Instruction,
    pubkey::Pubkey, system_program,
};
use district::{errors::DistrictError, pda};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::AccountSharedData, account_info::AccountInfo, instruction::InstructionError,
    signature::Keypair, signer::Signer, transaction::Transaction, transaction::TransactionError,
    transport::TransportError,
};

use super::fixtures::install_program_data;
use super::NOW;

pub type SendResult = Result<(), TransportError>;

/// Keys used across a test. The bank lives separately in `ProgramTestContext`
/// so helpers can take `(&mut ProgramTestContext, &Harness)`.
pub struct Harness {
    /// Upgrade authority, and admin after `initialize_config`.
    pub admin: Keypair,
    pub mission_authority: Keypair,
    /// Holds the citizens these tests register.
    pub holder: Keypair,
    /// Owns nothing and should be refused everywhere.
    pub impostor: Keypair,
    /// Successor admin, and the new owner in transfer tests.
    pub successor: Keypair,
    pub utility_mint: Keypair,
    pub collection_mint: Pubkey,
    pub sol_treasury: Pubkey,
    /// `warp_to_slot` only moves forward and the context cannot report the
    /// current slot, so the next target is tracked here.
    next_warp_slot: Cell<u64>,
}

impl Harness {
    pub fn config_key(&self) -> Pubkey {
        pda::config_address().0
    }

    pub fn template_key(&self) -> Pubkey {
        pda::approved_template_address(super::APPROVED_TEMPLATE_ID).0
    }

    pub fn program_data_key(&self) -> Pubkey {
        Pubkey::find_program_address(&[district::ID.as_ref()], &bpf_loader_upgradeable::ID).0
    }

    pub fn citizen_pda(&self, asset: &Pubkey) -> Pubkey {
        pda::citizen_address(asset).0
    }

    pub fn claim_receipt_pda(&self, asset: &Pubkey, mission_id: u64, nonce: u64) -> Pubkey {
        pda::claim_receipt_address(asset, mission_id, nonce).0
    }
}

/// Anchor's `entry` ties one lifetime to both the slice and its elements,
/// which `processor!` cannot express. The bank drops every `AccountInfo`
/// before returning, so widening the lifetime here is sound.
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts =
        unsafe { std::mem::transmute::<&[AccountInfo<'_>], &[AccountInfo<'_>]>(accounts) };
    district::entry(program_id, accounts, data)
}

pub async fn start() -> (ProgramTestContext, Harness) {
    let mut program_test =
        ProgramTest::new("district", district::ID, processor!(process_instruction));
    program_test.set_compute_max_units(1_400_000);
    let mut context = program_test.start_with_context().await;

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
        collection_mint: Pubkey::new_unique(),
        sol_treasury: Pubkey::new_unique(),
        next_warp_slot: Cell::new(2),
    };

    // `init` and the receipt creation draw rent from the declared payer, not
    // the fee payer, so these keys need their own balance.
    for key in [
        harness.admin.pubkey(),
        harness.holder.pubkey(),
        harness.impostor.pubkey(),
        harness.successor.pubkey(),
    ] {
        context.set_account(
            &key,
            &AccountSharedData::new(10_000_000_000, 0, &system_program::ID),
        );
    }

    install_program_data(&mut context, &harness, Some(harness.admin.pubkey()));
    (context, harness)
}

/// Sends one instruction signed by the fee payer plus `signers`.
pub async fn send(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    signers: &[&Keypair],
) -> SendResult {
    let mut all_signers: Vec<&Keypair> = vec![&context.payer];
    all_signers.extend(
        signers
            .iter()
            .filter(|s| s.pubkey() != context.payer.pubkey()),
    );

    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &all_signers,
        context.last_blockhash,
    );
    let executed = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await?;
    executed.result.map_err(TransportError::TransactionError)
}

/// Moves to a fresh blockhash. A byte-identical transaction would otherwise
/// be rejected as `AlreadyProcessed` before the program runs.
pub async fn advance(context: &mut ProgramTestContext, harness: &Harness) {
    let slot = harness.next_warp_slot.get();
    harness.next_warp_slot.set(slot + 1_000);
    context.warp_to_slot(slot).expect("warp to a later slot");
    context.last_blockhash = context
        .get_new_latest_blockhash()
        .await
        .expect("a fresh blockhash");
}

pub fn custom_error_code(failure: &TransportError) -> u32 {
    match failure {
        TransportError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => *code,
        other => panic!("expected a custom program error, got {other:?}"),
    }
}

pub fn expect_error(result: SendResult, expected: DistrictError) {
    let failure = result.expect_err("the instruction was supposed to fail");
    assert_eq!(
        custom_error_code(&failure),
        u32::from(expected),
        "expected {expected:?}, got {failure}"
    );
}

pub fn expect_anchor_error(result: SendResult, expected: anchor_lang::error::ErrorCode) {
    let failure = result.expect_err("the instruction was supposed to fail");
    assert_eq!(
        custom_error_code(&failure),
        u32::from(expected),
        "expected {expected:?}, got {failure}"
    );
}

/// The system program's `AccountAlreadyInUse`, surfaced by `init` on replay.
pub fn expect_account_already_in_use(result: SendResult) {
    use anchor_lang::solana_program::system_instruction::SystemError;
    let failure = result.expect_err("re-creating an existing PDA must fail");
    assert_eq!(
        custom_error_code(&failure),
        SystemError::AccountAlreadyInUse as u32,
        "expected AccountAlreadyInUse, got {failure}"
    );
}
