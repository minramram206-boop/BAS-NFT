//! Test bank for the prize vault: the program, its ProgramData, an authority,
//! a few winners and a stranger, each with SOL.
//!
//! `BAS_PRIZE=sbf` loads `prize_vault.so` from `SBF_OUT_DIR` instead of
//! running the program natively. `emit!` output is not visible here, so
//! tests assert committed state.

#![allow(dead_code)]

use anchor_lang::{
    solana_program::{bpf_loader_upgradeable, system_instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use prize_vault::{
    constants::{DISPUTE_HOURS, HOUR_SECONDS},
    errors::PrizeError,
    merkle, pda,
    state::{PrizeConfig, PrizeVault, Season},
    ClaimArgs, FinalizeWinnersArgs,
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    rent::Rent,
    signature::Keypair,
    signer::Signer,
    transaction::{Transaction, TransactionError},
    transport::TransportError,
};

pub const SOL: u64 = 1_000_000_000;
pub const STARTING_BALANCE: u64 = 100 * SOL;
pub const DISPUTE_SECONDS: i64 = DISPUTE_HOURS * HOUR_SECONDS;
/// Ten years of seconds: long after any window there could have been.
pub const DECADE_SECONDS: i64 = 10 * 365 * 86_400;

pub type SendResult = Result<(), TransportError>;

/// Anchor's `entry` ties one lifetime to both the slice and its elements,
/// which `processor!` cannot express. The bank drops every `AccountInfo`
/// before returning, so widening the lifetime here is sound.
fn prize_entry(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let accounts =
        unsafe { std::mem::transmute::<&[AccountInfo<'_>], &[AccountInfo<'_>]>(accounts) };
    prize_vault::entry(program_id, accounts, data)
}

pub struct World {
    pub context: ProgramTestContext,
    pub authority: Keypair,
    pub winners: Vec<Keypair>,
    pub stranger: Keypair,
    next_slot: u64,
}

/// One row of a published winners list.
#[derive(Clone, Copy, Debug)]
pub struct Prize {
    pub winner: Pubkey,
    pub amount: u64,
}

pub struct Published {
    pub season_id: u32,
    pub prizes: Vec<Prize>,
    pub leaves: Vec<[u8; 32]>,
    pub root: [u8; 32],
}

impl Published {
    pub fn new(season_id: u32, prizes: Vec<Prize>) -> Self {
        let leaves: Vec<[u8; 32]> = prizes
            .iter()
            .enumerate()
            .map(|(index, prize)| merkle::leaf(season_id, index as u8, &prize.winner, prize.amount))
            .collect();
        let root = merkle::root(&leaves);
        Self {
            season_id,
            prizes,
            leaves,
            root,
        }
    }

    pub fn total(&self) -> u64 {
        self.prizes.iter().map(|prize| prize.amount).sum()
    }

    pub fn proof(&self, index: usize) -> Vec<[u8; 32]> {
        merkle::proof(&self.leaves, index)
    }
}

pub async fn start() -> World {
    let mut program_test = ProgramTest::default();
    program_test.prefer_bpf(std::env::var("BAS_PRIZE").as_deref() == Ok("sbf"));
    program_test.add_program("prize_vault", prize_vault::ID, processor!(prize_entry));
    let context = program_test.start_with_context().await;
    let mut world = World {
        context,
        authority: Keypair::new(),
        winners: (0..4).map(|_| Keypair::new()).collect(),
        stranger: Keypair::new(),
        next_slot: 2,
    };
    let mut keys = vec![world.authority.pubkey(), world.stranger.pubkey()];
    keys.extend(world.winners.iter().map(|key| key.pubkey()));
    let funding: Vec<Instruction> = keys
        .iter()
        .map(|key| {
            system_instruction::transfer(&world.context.payer.pubkey(), key, STARTING_BALANCE)
        })
        .collect();
    world.send(&funding, &[]).await.expect("fund test keys");
    let authority = world.authority.pubkey();
    world.install_program_data(Some(authority)).await;
    world
}

/// A bank with the vault open and `deposit` SOL in it, as fee sharing would send.
pub async fn opened(deposit: u64) -> World {
    let mut world = start().await;
    world.initialize().await.expect("initialize");
    world.deposit(deposit).await;
    world
}

pub fn program_data_key() -> Pubkey {
    Pubkey::find_program_address(&[prize_vault::ID.as_ref()], &bpf_loader_upgradeable::ID).0
}

pub fn config_key() -> Pubkey {
    pda::config_address().0
}

pub fn vault_key() -> Pubkey {
    pda::vault_address().0
}

pub fn season_key(season_id: u32) -> Pubkey {
    pda::season_address(season_id).0
}

pub fn vault_rent() -> u64 {
    Rent::default().minimum_balance(PrizeVault::LEN)
}

impl World {
    // --- bank ---------------------------------------------------------------

    pub async fn balance(&mut self, key: &Pubkey) -> u64 {
        self.context
            .banks_client
            .get_balance(*key)
            .await
            .expect("balance")
    }

    pub async fn account(&mut self, key: &Pubkey) -> Option<Account> {
        self.context
            .banks_client
            .get_account(*key)
            .await
            .expect("account lookup")
    }

    /// The upgradeable loader's ProgramData, bincode encoded: variant tag 3,
    /// slot, then `Option<Pubkey>` for the upgrade authority.
    pub async fn install_program_data(&mut self, authority: Option<Pubkey>) {
        let mut data = 3u32.to_le_bytes().to_vec();
        data.extend_from_slice(&0u64.to_le_bytes());
        match authority {
            Some(key) => {
                data.push(1);
                data.extend_from_slice(key.as_ref());
            }
            None => data.push(0),
        }
        let lamports = Rent::default().minimum_balance(data.len());
        let payer_key = self.context.payer.pubkey();
        let mut payer = self.account(&payer_key).await.expect("payer account");
        payer.lamports -= lamports;
        self.context
            .set_account(&payer_key, &AccountSharedData::from(payer));
        self.context.set_account(
            &program_data_key(),
            &AccountSharedData::from(Account {
                lamports,
                data,
                owner: bpf_loader_upgradeable::ID,
                executable: false,
                rent_epoch: u64::MAX,
            }),
        );
    }

    /// Sends `instructions` in one transaction, paid by the context payer.
    pub async fn send(&mut self, instructions: &[Instruction], signers: &[&Keypair]) -> SendResult {
        let payer = self.context.payer.pubkey();
        let mut all: Vec<&Keypair> = vec![&self.context.payer];
        all.extend(signers.iter().filter(|key| key.pubkey() != payer));
        let transaction = Transaction::new_signed_with_payer(
            instructions,
            Some(&payer),
            &all,
            self.context.last_blockhash,
        );
        let processed = self
            .context
            .banks_client
            .process_transaction_with_metadata(transaction)
            .await?;
        self.advance().await;
        processed.result.map_err(TransportError::TransactionError)
    }

    /// A fresh blockhash, so a byte-identical retry is not `AlreadyProcessed`.
    async fn advance(&mut self) {
        self.context
            .warp_to_slot(self.next_slot)
            .expect("warp to a later slot");
        self.next_slot += 2;
        self.context.last_blockhash = self
            .context
            .get_new_latest_blockhash()
            .await
            .expect("a fresh blockhash");
    }

    pub async fn now(&mut self) -> i64 {
        let clock: Clock = self.context.banks_client.get_sysvar().await.expect("clock");
        clock.unix_timestamp
    }

    pub async fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.context.banks_client.get_sysvar().await.expect("clock");
        clock.unix_timestamp = unix_timestamp;
        self.context.set_sysvar(&clock);
    }

    pub async fn config(&mut self) -> PrizeConfig {
        let account = self.account(&config_key()).await.expect("config exists");
        PrizeConfig::try_deserialize(&mut account.data.as_slice()).expect("config decodes")
    }

    pub async fn season(&mut self, season_id: u32) -> Season {
        let account = self
            .account(&season_key(season_id))
            .await
            .expect("season exists");
        Season::try_deserialize(&mut account.data.as_slice()).expect("season decodes")
    }

    /// SOL sent to the vault by a plain system transfer, the way fee sharing pays it.
    pub async fn deposit(&mut self, lamports: u64) {
        let payer = self.context.payer.pubkey();
        self.send(
            &[system_instruction::transfer(&payer, &vault_key(), lamports)],
            &[],
        )
        .await
        .expect("deposit into the vault");
    }

    // --- instructions -------------------------------------------------------

    pub fn initialize_ix(&self, signer: &Pubkey) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::Initialize {
                config: config_key(),
                vault: vault_key(),
                program_data: program_data_key(),
                authority: *signer,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::Initialize {}.data(),
        }
    }

    pub async fn initialize(&mut self) -> SendResult {
        let authority = self.authority.insecure_clone();
        let ix = self.initialize_ix(&authority.pubkey());
        self.send(&[ix], &[&authority]).await
    }

    pub fn fund_ix(
        &self,
        signer: &Pubkey,
        season_id: u32,
        amount_lamports: u64,
        ends_at: i64,
    ) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::FundSeason {
                config: config_key(),
                vault: vault_key(),
                season: season_key(season_id),
                authority: *signer,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::FundSeason {
                season_id,
                amount_lamports,
                ends_at,
            }
            .data(),
        }
    }

    pub async fn fund(&mut self, season_id: u32, amount_lamports: u64, ends_at: i64) -> SendResult {
        let authority = self.authority.insecure_clone();
        let ix = self.fund_ix(&authority.pubkey(), season_id, amount_lamports, ends_at);
        self.send(&[ix], &[&authority]).await
    }

    pub fn finalize_ix(
        &self,
        signer: &Pubkey,
        season_id: u32,
        root: [u8; 32],
        winners: u8,
        prizes_lamports: u64,
    ) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::FinalizeWinners {
                config: config_key(),
                season: season_key(season_id),
                authority: *signer,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::FinalizeWinners {
                season_id,
                args: FinalizeWinnersArgs {
                    winners_root: root,
                    winners,
                    prizes_lamports,
                },
            }
            .data(),
        }
    }

    pub async fn finalize(&mut self, published: &Published) -> SendResult {
        let authority = self.authority.insecure_clone();
        let ix = self.finalize_ix(
            &authority.pubkey(),
            published.season_id,
            published.root,
            published.prizes.len() as u8,
            published.total(),
        );
        self.send(&[ix], &[&authority]).await
    }

    pub fn claim_ix(
        &self,
        winner: &Pubkey,
        season_id: u32,
        index: u8,
        amount_lamports: u64,
        proof: Vec<[u8; 32]>,
    ) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::Claim {
                config: config_key(),
                vault: vault_key(),
                season: season_key(season_id),
                winner: *winner,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::Claim {
                season_id,
                args: ClaimArgs {
                    index,
                    amount_lamports,
                    proof,
                },
            }
            .data(),
        }
    }

    /// Winner `index` of `published` claims with its own proof.
    pub async fn claim(
        &mut self,
        published: &Published,
        index: usize,
        signer: &Keypair,
    ) -> SendResult {
        let prize = published.prizes[index];
        let ix = self.claim_ix(
            &signer.pubkey(),
            published.season_id,
            index as u8,
            prize.amount,
            published.proof(index),
        );
        self.send(&[ix], &[signer]).await
    }

    pub fn rollover_ix(&self, caller: &Pubkey, season_id: u32) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::Rollover {
                config: config_key(),
                season: season_key(season_id),
                caller: *caller,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::Rollover { season_id }.data(),
        }
    }

    pub async fn rollover(&mut self, season_id: u32, caller: &Keypair) -> SendResult {
        let ix = self.rollover_ix(&caller.pubkey(), season_id);
        self.send(&[ix], &[caller]).await
    }

    pub fn propose_ix(&self, signer: &Pubkey, proposed: Pubkey) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::ProposeAuthority {
                config: config_key(),
                authority: *signer,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::ProposeAuthority { proposed }.data(),
        }
    }

    pub fn accept_ix(&self, signer: &Pubkey) -> Instruction {
        Instruction {
            program_id: prize_vault::ID,
            accounts: prize_vault::accounts::AcceptAuthority {
                config: config_key(),
                pending_authority: *signer,
            }
            .to_account_metas(None),
            data: prize_vault::instruction::AcceptAuthority {}.data(),
        }
    }

    /// A season `id` funded with `amount`, ended, and its winners published
    /// with the dispute window passed, so claims are open.
    pub async fn claimable(
        &mut self,
        season_id: u32,
        amount: u64,
        prizes: Vec<Prize>,
    ) -> Published {
        let start = self.now().await;
        self.fund(season_id, amount, start + 1_000)
            .await
            .expect("fund");
        self.set_time(start + 1_000).await;
        let published = Published::new(season_id, prizes);
        self.finalize(&published).await.expect("finalize");
        self.set_time(start + 1_000 + DISPUTE_SECONDS).await;
        published
    }

    pub fn winner(&self, index: usize) -> Keypair {
        self.winners[index].insecure_clone()
    }
}

// --- errors -----------------------------------------------------------------

fn instruction_error(result: SendResult) -> (u8, InstructionError) {
    match result {
        Err(TransportError::TransactionError(TransactionError::InstructionError(index, error))) => {
            (index, error)
        }
        other => panic!("expected an instruction error, got {other:?}"),
    }
}

pub fn custom_code(result: SendResult) -> u32 {
    match instruction_error(result) {
        (_, InstructionError::Custom(code)) => code,
        (_, other) => panic!("expected a custom program error, got {other:?}"),
    }
}

pub fn expect_error(result: SendResult, expected: PrizeError) {
    assert_eq!(
        custom_code(result),
        u32::from(expected),
        "expected {expected:?}"
    );
}

pub fn expect_anchor_error(result: SendResult, expected: anchor_lang::error::ErrorCode) {
    assert_eq!(
        custom_code(result),
        u32::from(expected),
        "expected {expected:?}"
    );
}
