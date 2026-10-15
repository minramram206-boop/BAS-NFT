//! Test bank for the market: the market program, the Metaplex Core program
//! and a district-like collection with a Royalties plugin, as on devnet.
//!
//! Core runs from `tests/fixtures/mpl_core.so` when that file exists (dump it
//! from devnet, see docs/MARKET.md) and otherwise natively from the Core
//! 0.9.8 source. `BAS_CORE=so` or `BAS_CORE=native` forces one of the two.
//! `BAS_MARKET=sbf` loads `market.so` from `SBF_OUT_DIR` instead of running
//! the market natively.
//!
//! `emit!` output is not visible here, so tests assert committed state.

use std::path::Path;

use anchor_lang::{
    solana_program::{bpf_loader_upgradeable, system_instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use market::{
    core_asset::MPL_CORE_PROGRAM_ID,
    errors::MarketError,
    pda,
    state::{Auction, Listing, MarketConfig},
    InitializeConfigArgs,
};
use mpl_core::{
    instructions::{
        AddPluginV1Builder, ApprovePluginAuthorityV1Builder, BurnV1Builder,
        CreateCollectionV1Builder, CreateV1Builder, RevokePluginAuthorityV1Builder,
        TransferV1Builder, UpdatePluginV1Builder,
    },
    types::{
        Creator, FreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair, PluginType,
        Royalties, RuleSet, TransferDelegate, UpdateAuthority,
    },
    Asset,
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    clock::Clock,
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    rent::Rent,
    signature::Keypair,
    signer::Signer,
    transaction::{Transaction, TransactionError},
    transport::TransportError,
};

pub use market;
pub use mpl_core;

pub const SOL: u64 = 1_000_000_000;
pub const ROYALTY_BPS: u16 = 500;
pub const STARTING_BALANCE: u64 = 100 * SOL;

pub type SendResult = Result<(), TransportError>;

/// Anchor's `entry` ties one lifetime to both the slice and its elements,
/// which `processor!` cannot express. The bank drops every `AccountInfo`
/// before returning, so widening the lifetime here is sound.
fn market_entry(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let accounts =
        unsafe { std::mem::transmute::<&[AccountInfo<'_>], &[AccountInfo<'_>]>(accounts) };
    market::entry(program_id, accounts, data)
}

/// Same lifetime widening for Core's processor.
fn core_entry(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let accounts =
        unsafe { std::mem::transmute::<&[AccountInfo<'_>], &[AccountInfo<'_>]>(accounts) };
    mpl_core_program::processor::process_instruction(program_id, accounts, data)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoreBuild {
    /// The deployed binary from `tests/fixtures/mpl_core.so`.
    Deployed,
    /// Core 0.9.8 compiled for the host.
    Source,
}

pub fn core_build() -> CoreBuild {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mpl_core.so");
    match std::env::var("BAS_CORE").as_deref() {
        Ok("so") => {
            assert!(
                fixture.exists(),
                "BAS_CORE=so but {} is missing",
                fixture.display()
            );
            CoreBuild::Deployed
        }
        Ok("native") => CoreBuild::Source,
        _ if fixture.exists() => CoreBuild::Deployed,
        _ => CoreBuild::Source,
    }
}

/// Everyone a market test needs, plus the bank.
pub struct World {
    pub context: ProgramTestContext,
    /// Upgrade authority of the market, its admin, and update authority of both collections.
    pub admin: Keypair,
    /// The collection's royalty creator and the market's royalty recipient.
    pub treasury: Keypair,
    pub fee_recipient: Keypair,
    pub seller: Keypair,
    pub buyer: Keypair,
    pub stranger: Keypair,
    /// The citizen collection the market trades.
    pub collection: Pubkey,
    /// Another Core collection, whose assets the market must refuse.
    pub other_collection: Pubkey,
    next_slot: u64,
}

pub async fn start() -> World {
    let mut program_test = ProgramTest::default();
    program_test.prefer_bpf(std::env::var("BAS_MARKET").as_deref() == Ok("sbf"));
    program_test.add_program("market", market::ID, processor!(market_entry));
    match core_build() {
        CoreBuild::Deployed => {
            program_test.prefer_bpf(true);
            program_test.add_program("mpl_core", MPL_CORE_PROGRAM_ID, None);
        }
        CoreBuild::Source => {
            program_test.prefer_bpf(false);
            program_test.add_program(
                "mpl_core_program",
                MPL_CORE_PROGRAM_ID,
                processor!(core_entry),
            );
        }
    }
    program_test.set_compute_max_units(1_400_000);
    let context = program_test.start_with_context().await;

    let mut world = World {
        context,
        admin: Keypair::new(),
        treasury: Keypair::new(),
        fee_recipient: Keypair::new(),
        seller: Keypair::new(),
        buyer: Keypair::new(),
        stranger: Keypair::new(),
        collection: Pubkey::default(),
        other_collection: Pubkey::default(),
        next_slot: 2,
    };
    let funding: Vec<Instruction> = [
        world.admin.pubkey(),
        world.treasury.pubkey(),
        world.fee_recipient.pubkey(),
        world.seller.pubkey(),
        world.buyer.pubkey(),
        world.stranger.pubkey(),
    ]
    .iter()
    .map(|key| system_instruction::transfer(&world.context.payer.pubkey(), key, STARTING_BALANCE))
    .collect();
    world.send(&funding, &[]).await.expect("fund test keys");
    let admin = world.admin.pubkey();
    world.install_program_data(Some(admin)).await;
    world.collection = world.create_collection().await;
    world.other_collection = world.create_collection().await;
    world
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

    /// The upgradeable loader's ProgramData for the market, bincode encoded:
    /// variant tag 3, slot, then `Option<Pubkey>` for the upgrade authority.
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
        self.install_account(&program_data_key(), data, bpf_loader_upgradeable::ID)
            .await;
    }

    /// Writes an account straight into the bank. Its rent comes out of the
    /// payer's balance: the bank checks that total lamports never change
    /// when it moves to a new slot, so they cannot be created from nothing.
    pub async fn install_account(&mut self, key: &Pubkey, data: Vec<u8>, owner: Pubkey) {
        let lamports = Rent::default().minimum_balance(data.len());
        let previous = self.balance(key).await;
        let payer_key = self.context.payer.pubkey();
        let mut payer = self.account(&payer_key).await.expect("payer account");
        payer.lamports = payer.lamports + previous - lamports;
        self.context
            .set_account(&payer_key, &AccountSharedData::from(payer));
        self.context.set_account(
            key,
            &AccountSharedData::from(Account {
                lamports,
                data,
                owner,
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

    // --- Core ---------------------------------------------------------------

    /// A collection with the citizen collection's Royalties plugin: 500 bps
    /// to one creator and no rule set (SPEC §6.2).
    async fn create_collection(&mut self) -> Pubkey {
        let collection = Keypair::new();
        let instruction = CreateCollectionV1Builder::new()
            .collection(collection.pubkey())
            .update_authority(Some(self.admin.pubkey()))
            .payer(self.admin.pubkey())
            .name("BAS District 01".into())
            .uri("https://example.invalid/collection.json".into())
            .plugins(vec![PluginAuthorityPair {
                plugin: Plugin::Royalties(Royalties {
                    basis_points: ROYALTY_BPS,
                    creators: vec![Creator {
                        address: self.treasury.pubkey(),
                        percentage: 100,
                    }],
                    rule_set: RuleSet::None,
                }),
                authority: None,
            }])
            .instruction();
        let admin = self.admin.insecure_clone();
        self.send(&[instruction], &[&admin, &collection])
            .await
            .expect("create collection");
        collection.pubkey()
    }

    /// Mints a citizen into `collection` for `owner`, the way the candy machine does.
    pub async fn mint_into(&mut self, collection: Pubkey, owner: &Pubkey, number: u32) -> Pubkey {
        let asset = Keypair::new();
        let instruction = CreateV1Builder::new()
            .asset(asset.pubkey())
            .collection(Some(collection))
            .authority(Some(self.admin.pubkey()))
            .payer(self.admin.pubkey())
            .owner(Some(*owner))
            .name(format!("Citizen #{number:03}"))
            .uri(format!(
                "https://example.invalid/templates/7/{number:03}.json"
            ))
            .instruction();
        let admin = self.admin.insecure_clone();
        self.send(&[instruction], &[&admin, &asset])
            .await
            .expect("mint citizen");
        asset.pubkey()
    }

    pub async fn mint(&mut self, owner: &Pubkey) -> Pubkey {
        let collection = self.collection;
        self.mint_into(collection, owner, 13).await
    }

    pub async fn core_asset(&mut self, asset: &Pubkey) -> Box<Asset> {
        let account = self.account(asset).await.expect("asset account");
        Asset::from_bytes(&account.data).expect("Core decodes its own asset")
    }

    pub async fn owner_of(&mut self, asset: &Pubkey) -> Pubkey {
        self.core_asset(asset).await.base.owner
    }

    /// The Core instructions a client sends before `create_listing` so that
    /// `delegate` holds the TransferDelegate: none when it already does, an add
    /// when the asset has no such plugin, an approve when the owner holds it,
    /// and a revoke then an approve when someone else does, because Core
    /// refuses to re-point a delegated plugin directly (`CannotRedelegate`).
    pub async fn delegate_ix(&mut self, asset: &Pubkey, owner: &Pubkey, delegate: &Pubkey) -> Vec<Instruction> {
        let core = self.core_asset(asset).await;
        let current = core
            .plugin_list
            .transfer_delegate
            .as_ref()
            .map(|plugin| plugin.base.authority.clone());
        self.point_plugin_at(&core, asset, owner, delegate, PluginType::TransferDelegate, current)
    }

    /// Shared by both delegates; `current` is the plugin's authority, if the plugin exists.
    fn point_plugin_at(
        &self,
        core: &Asset,
        asset: &Pubkey,
        owner: &Pubkey,
        delegate: &Pubkey,
        plugin_type: PluginType,
        current: Option<mpl_core::BaseAuthority>,
    ) -> Vec<Instruction> {
        let collection = collection_of(core);
        let authority = PluginAuthority::Address { address: *delegate };
        let approve = || {
            ApprovePluginAuthorityV1Builder::new()
                .asset(*asset)
                .collection(Some(collection))
                .payer(*owner)
                .authority(Some(*owner))
                .plugin_type(plugin_type.clone())
                .new_authority(authority.clone())
                .instruction()
        };
        match current {
            None => {
                let plugin = match plugin_type {
                    PluginType::FreezeDelegate => Plugin::FreezeDelegate(FreezeDelegate { frozen: false }),
                    _ => Plugin::TransferDelegate(TransferDelegate {}),
                };
                vec![AddPluginV1Builder::new()
                    .asset(*asset)
                    .collection(Some(collection))
                    .payer(*owner)
                    .authority(Some(*owner))
                    .plugin(plugin)
                    .init_authority(authority.clone())
                    .instruction()]
            }
            Some(current) if current.address == Some(*delegate) => vec![],
            Some(current) if current.address.is_some() => vec![
                RevokePluginAuthorityV1Builder::new()
                    .asset(*asset)
                    .collection(Some(collection))
                    .payer(*owner)
                    .authority(Some(*owner))
                    .plugin_type(plugin_type.clone())
                    .instruction(),
                approve(),
            ],
            Some(_) => vec![approve()],
        }
    }

    /// `ApprovePluginAuthorityV1` on the TransferDelegate, with no revoke in front.
    pub fn approve_transfer_ix(&self, asset: &Pubkey, owner: &Pubkey, delegate: &Pubkey) -> Instruction {
        ApprovePluginAuthorityV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(*owner)
            .authority(Some(*owner))
            .plugin_type(PluginType::TransferDelegate)
            .new_authority(PluginAuthority::Address { address: *delegate })
            .instruction()
    }

    /// What a client sends alongside `cancel_listing`.
    pub fn revoke_delegate_ix(&self, asset: &Pubkey, owner: &Pubkey) -> Instruction {
        RevokePluginAuthorityV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(*owner)
            .authority(Some(*owner))
            .plugin_type(PluginType::TransferDelegate)
            .instruction()
    }

    /// The owner moves the asset with a plain Core transfer, outside the market.
    pub async fn core_transfer(
        &mut self,
        asset: &Pubkey,
        owner: &Keypair,
        to: &Pubkey,
    ) -> SendResult {
        let instruction = TransferV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(owner.pubkey())
            .authority(Some(owner.pubkey()))
            .new_owner(*to)
            .instruction();
        self.send(&[instruction], &[owner]).await
    }

    pub async fn core_burn(&mut self, asset: &Pubkey, owner: &Keypair) -> SendResult {
        let instruction = BurnV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(owner.pubkey())
            .authority(Some(owner.pubkey()))
            .instruction();
        self.send(&[instruction], &[owner]).await
    }

    /// Adds a FreezeDelegate held by the owner and freezes the asset.
    pub async fn core_freeze(&mut self, asset: &Pubkey, owner: &Keypair) -> SendResult {
        let add = AddPluginV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(owner.pubkey())
            .authority(Some(owner.pubkey()))
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
            .instruction();
        let freeze = UpdatePluginV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(owner.pubkey())
            .authority(Some(owner.pubkey()))
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
            .instruction();
        self.send(&[add, freeze], &[owner]).await
    }

    // --- market -------------------------------------------------------------

    pub fn config_key(&self) -> Pubkey {
        pda::config_address().0
    }

    pub fn authority_key(&self) -> Pubkey {
        pda::authority_address().0
    }

    pub fn listing_key(&self, asset: &Pubkey) -> Pubkey {
        pda::listing_address(asset).0
    }

    /// `initialize_config` with the treasury and fee keys as recipients.
    pub fn initialize_ix(
        &self,
        signer: &Pubkey,
        collection: Pubkey,
        args: InitializeConfigArgs,
    ) -> Instruction {
        let recipients = (self.treasury.pubkey(), self.fee_recipient.pubkey());
        self.initialize_ix_paying(signer, collection, (&recipients.0, &recipients.1), args)
    }

    pub fn initialize_ix_paying(
        &self,
        signer: &Pubkey,
        collection: Pubkey,
        recipients: (&Pubkey, &Pubkey),
        args: InitializeConfigArgs,
    ) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::InitializeConfig {
                config: self.config_key(),
                collection,
                royalty_recipient: *recipients.0,
                fee_recipient: *recipients.1,
                program_data: program_data_key(),
                admin: *signer,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: market::instruction::InitializeConfig { args }.data(),
        }
    }

    pub fn update_config_ix(
        &self,
        signer: &Pubkey,
        recipients: (&Pubkey, &Pubkey),
        royalty_bps: u16,
        fee_bps: u16,
    ) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::UpdateConfigAccounts {
                config: self.config_key(),
                royalty_recipient: *recipients.0,
                fee_recipient: *recipients.1,
                admin: *signer,
            }
            .to_account_metas(None),
            data: market::instruction::UpdateConfig {
                args: market::UpdateConfigArgs {
                    royalty_bps,
                    fee_bps,
                },
            }
            .data(),
        }
    }

    pub fn set_paused_ix(&self, signer: &Pubkey, paused: bool) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::SetPaused {
                config: self.config_key(),
                admin: *signer,
            }
            .to_account_metas(None),
            data: market::instruction::SetPaused { paused }.data(),
        }
    }

    pub fn propose_admin_ix(&self, signer: &Pubkey, proposed_admin: Pubkey) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::ProposeAdmin {
                config: self.config_key(),
                admin: *signer,
            }
            .to_account_metas(None),
            data: market::instruction::ProposeAdmin { proposed_admin }.data(),
        }
    }

    pub fn accept_admin_ix(&self, signer: &Pubkey) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::AcceptAdmin {
                config: self.config_key(),
                new_admin: *signer,
            }
            .to_account_metas(None),
            data: market::instruction::AcceptAdmin {}.data(),
        }
    }

    pub fn create_listing_ix(
        &self,
        asset: &Pubkey,
        seller: &Pubkey,
        price_lamports: u64,
    ) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::CreateListing {
                config: self.config_key(),
                listing: self.listing_key(asset),
                asset: *asset,
                seller: *seller,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: market::instruction::CreateListing { price_lamports }.data(),
        }
    }

    pub fn update_price_ix(
        &self,
        asset: &Pubkey,
        seller: &Pubkey,
        price_lamports: u64,
    ) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::UpdatePrice {
                config: self.config_key(),
                listing: self.listing_key(asset),
                asset: *asset,
                seller: *seller,
            }
            .to_account_metas(None),
            data: market::instruction::UpdatePrice { price_lamports }.data(),
        }
    }

    pub fn cancel_ix(&self, asset: &Pubkey, seller: &Pubkey) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::CancelListing {
                listing: self.listing_key(asset),
                seller: *seller,
            }
            .to_account_metas(None),
            data: market::instruction::CancelListing {}.data(),
        }
    }

    pub fn close_stale_ix(&self, asset: &Pubkey, seller: &Pubkey, caller: &Pubkey) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::CloseStaleListing {
                config: self.config_key(),
                listing: self.listing_key(asset),
                asset: *asset,
                seller: *seller,
                caller: *caller,
            }
            .to_account_metas(None),
            data: market::instruction::CloseStaleListing {}.data(),
        }
    }

    pub fn buy_accounts(
        &self,
        asset: &Pubkey,
        seller: &Pubkey,
        buyer: &Pubkey,
    ) -> market::accounts::Buy {
        market::accounts::Buy {
            config: self.config_key(),
            listing: self.listing_key(asset),
            asset: *asset,
            collection: self.collection,
            seller: *seller,
            buyer: *buyer,
            royalty_recipient: self.treasury.pubkey(),
            fee_recipient: self.fee_recipient.pubkey(),
            market_authority: self.authority_key(),
            core_program: MPL_CORE_PROGRAM_ID,
            system_program: system_program::ID,
        }
    }

    pub fn buy_ix_with(
        &self,
        accounts: market::accounts::Buy,
        max_price_lamports: u64,
    ) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: accounts.to_account_metas(None),
            data: market::instruction::Buy { max_price_lamports }.data(),
        }
    }

    pub fn buy_ix(
        &self,
        asset: &Pubkey,
        seller: &Pubkey,
        buyer: &Pubkey,
        max_price_lamports: u64,
    ) -> Instruction {
        self.buy_ix_with(self.buy_accounts(asset, seller, buyer), max_price_lamports)
    }

    // --- flows --------------------------------------------------------------

    /// Initializes the market with the devnet terms (5% royalty, no fee) and opens it.
    pub async fn open_market(&mut self) {
        let admin = self.admin.insecure_clone();
        let init = self.initialize_ix(
            &admin.pubkey(),
            self.collection,
            InitializeConfigArgs {
                royalty_bps: ROYALTY_BPS,
                fee_bps: 0,
            },
        );
        let open = self.set_paused_ix(&admin.pubkey(), false);
        self.send(&[init, open], &[&admin])
            .await
            .expect("initialize and open the market");
    }

    /// Delegate and listing in one transaction, as the web client sends them.
    pub async fn list(
        &mut self,
        asset: &Pubkey,
        seller: &Keypair,
        price_lamports: u64,
    ) -> SendResult {
        let authority = self.authority_key();
        let mut instructions = self.delegate_ix(asset, &seller.pubkey(), &authority).await;
        instructions.push(self.create_listing_ix(asset, &seller.pubkey(), price_lamports));
        self.send(&instructions, &[seller]).await
    }

    pub async fn buy(
        &mut self,
        asset: &Pubkey,
        buyer: &Keypair,
        max_price_lamports: u64,
    ) -> SendResult {
        let seller = self.listing(asset).await.expect("an open listing").seller;
        let instruction = self.buy_ix(asset, &seller, &buyer.pubkey(), max_price_lamports);
        self.send(&[instruction], &[buyer]).await
    }

    pub async fn listing(&mut self, asset: &Pubkey) -> Option<Listing> {
        let key = self.listing_key(asset);
        let account = self.account(&key).await?;
        Some(Listing::try_deserialize(&mut account.data.as_slice()).expect("a listing"))
    }

    pub async fn config(&mut self) -> MarketConfig {
        let key = self.config_key();
        let account = self.account(&key).await.expect("config account");
        MarketConfig::try_deserialize(&mut account.data.as_slice()).expect("a config")
    }
}

// --- auctions -------------------------------------------------------------------

impl World {
    pub fn auction_key(&self, asset: &Pubkey) -> Pubkey {
        pda::auction_address(asset).0
    }

    pub async fn auction(&mut self, asset: &Pubkey) -> Option<Auction> {
        let key = self.auction_key(asset);
        let account = self.account(&key).await?;
        Some(Auction::try_deserialize(&mut account.data.as_slice()).expect("an auction"))
    }

    /// The bank's clock, in Unix seconds.
    pub async fn now(&mut self) -> i64 {
        let clock: Clock = self.context.banks_client.get_sysvar().await.expect("clock");
        clock.unix_timestamp
    }

    /// Sets the clock the next transaction sees.
    pub async fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.context.banks_client.get_sysvar().await.expect("clock");
        clock.unix_timestamp = unix_timestamp;
        self.context.set_sysvar(&clock);
    }

    /// The Core instructions a client sends before `create_auction` so the
    /// market holds an unfrozen FreezeDelegate, by the same rules as `delegate_ix`.
    pub async fn freeze_delegate_ix(&mut self, asset: &Pubkey, owner: &Pubkey, delegate: &Pubkey) -> Vec<Instruction> {
        let core = self.core_asset(asset).await;
        let current = core
            .plugin_list
            .freeze_delegate
            .as_ref()
            .map(|plugin| plugin.base.authority.clone());
        self.point_plugin_at(&core, asset, owner, delegate, PluginType::FreezeDelegate, current)
    }

    pub fn create_auction_ix(&self, asset: &Pubkey, seller: &Pubkey, start_price_lamports: u64, duration_hours: u8) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::CreateAuction {
                config: self.config_key(),
                auction: self.auction_key(asset),
                listing: self.listing_key(asset),
                asset: *asset,
                collection: self.collection,
                seller: *seller,
                market_authority: self.authority_key(),
                core_program: MPL_CORE_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: market::instruction::CreateAuction {
                start_price_lamports,
                duration_hours,
            }
            .data(),
        }
    }

    /// Both delegates and `create_auction` in one transaction, as the web client sends them.
    pub async fn start_auction(&mut self, asset: &Pubkey, seller: &Keypair, start_price_lamports: u64, duration_hours: u8) -> SendResult {
        let authority = self.authority_key();
        let mut instructions = self.delegate_ix(asset, &seller.pubkey(), &authority).await;
        instructions.extend(self.freeze_delegate_ix(asset, &seller.pubkey(), &authority).await);
        instructions.push(self.create_auction_ix(asset, &seller.pubkey(), start_price_lamports, duration_hours));
        self.send(&instructions, &[seller]).await
    }

    pub fn bid_ix(&self, asset: &Pubkey, bidder: &Pubkey, amount_lamports: u64, previous_bidder: Option<Pubkey>) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::PlaceBid {
                config: self.config_key(),
                auction: self.auction_key(asset),
                asset: *asset,
                bidder: *bidder,
                previous_bidder,
                market_authority: self.authority_key(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: market::instruction::PlaceBid { amount_lamports }.data(),
        }
    }

    /// A bid that names the current highest bidder for the refund, as the client does.
    pub async fn bid(&mut self, asset: &Pubkey, bidder: &Keypair, amount_lamports: u64) -> SendResult {
        let auction = self.auction(asset).await.expect("an open auction");
        let previous = (auction.bid_count > 0).then_some(auction.highest_bidder);
        let instruction = self.bid_ix(asset, &bidder.pubkey(), amount_lamports, previous);
        self.send(&[instruction], &[bidder]).await
    }

    pub fn cancel_auction_ix(&self, asset: &Pubkey, seller: &Pubkey) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::CancelAuction {
                config: self.config_key(),
                auction: self.auction_key(asset),
                asset: *asset,
                collection: self.collection,
                seller: *seller,
                market_authority: self.authority_key(),
                core_program: MPL_CORE_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: market::instruction::CancelAuction {}.data(),
        }
    }

    /// `RevokePluginAuthorityV1` on `plugin_type`, sent by the owner.
    pub fn revoke_ix(&self, asset: &Pubkey, owner: &Pubkey, plugin_type: PluginType) -> Instruction {
        RevokePluginAuthorityV1Builder::new()
            .asset(*asset)
            .collection(Some(self.collection))
            .payer(*owner)
            .authority(Some(*owner))
            .plugin_type(plugin_type)
            .instruction()
    }

    pub fn settle_ix(&self, asset: &Pubkey, seller: &Pubkey, winner: Option<Pubkey>, caller: &Pubkey) -> Instruction {
        Instruction {
            program_id: market::ID,
            accounts: market::accounts::SettleAuction {
                config: self.config_key(),
                auction: self.auction_key(asset),
                asset: *asset,
                collection: self.collection,
                seller: *seller,
                winner,
                royalty_recipient: self.treasury.pubkey(),
                fee_recipient: self.fee_recipient.pubkey(),
                market_authority: self.authority_key(),
                core_program: MPL_CORE_PROGRAM_ID,
                caller: *caller,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: market::instruction::SettleAuction {}.data(),
        }
    }

    pub async fn settle(&mut self, asset: &Pubkey, caller: &Keypair) -> SendResult {
        let auction = self.auction(asset).await.expect("an auction");
        let winner = (auction.bid_count > 0).then_some(auction.highest_bidder);
        let instruction = self.settle_ix(asset, &auction.seller, winner, &caller.pubkey());
        self.send(&[instruction], &[caller]).await
    }

    /// The asset's FreezeDelegate as Core's own client reads it: (authority address, frozen).
    pub async fn freeze_state(&mut self, asset: &Pubkey) -> Option<(Option<Pubkey>, bool)> {
        let core = self.core_asset(asset).await;
        core.plugin_list
            .freeze_delegate
            .map(|plugin| (plugin.base.authority.address, plugin.freeze_delegate.frozen))
    }
}

pub fn auction_rent() -> u64 {
    Rent::default().minimum_balance(Auction::LEN)
}

/// A market that is open, with one citizen minted to the seller.
pub async fn market_with_citizen() -> (World, Pubkey) {
    let mut world = start().await;
    world.open_market().await;
    let seller = world.seller.pubkey();
    let asset = world.mint(&seller).await;
    (world, asset)
}

/// The collection a collection asset belongs to.
pub fn collection_of(asset: &Asset) -> Pubkey {
    match asset.base.update_authority {
        UpdateAuthority::Collection(collection) => collection,
        ref other => panic!("expected a collection asset, got {other:?}"),
    }
}

pub fn program_data_key() -> Pubkey {
    Pubkey::find_program_address(&[market::ID.as_ref()], &bpf_loader_upgradeable::ID).0
}

pub fn listing_rent() -> u64 {
    Rent::default().minimum_balance(Listing::LEN)
}

// --- error checks -----------------------------------------------------------

/// The failing instruction's index and error.
pub fn instruction_error(result: SendResult) -> (u8, InstructionError) {
    match result.expect_err("the transaction was supposed to fail") {
        TransportError::TransactionError(TransactionError::InstructionError(index, error)) => {
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

pub fn expect_market_error(result: SendResult, expected: MarketError) {
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

/// The system program's `AccountAlreadyInUse`, raised by `init` on an existing PDA.
pub fn expect_already_in_use(result: SendResult) {
    use solana_sdk::system_instruction::SystemError;
    assert_eq!(custom_code(result), SystemError::AccountAlreadyInUse as u32);
}
