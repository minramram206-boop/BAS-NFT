//! Shared test harness: the simulated bank, account fixtures, instruction
//! builders and the multi-step flows most tests start from.

pub mod bank;
pub mod fixtures;
pub mod flows;
pub mod ix;

pub use bank::*;
pub use fixtures::*;
pub use flows::*;
pub use ix::*;

pub use anchor_lang::solana_program::pubkey::Pubkey;
pub use district::{
    errors::DistrictError,
    roles::{CitizenRole, ROLE_COUNT, ROLE_TEMPLATES},
    state::CitizenStat,
    UpdateConfigArgs,
};
pub use solana_program_test::ProgramTestContext;
pub use solana_sdk::account::WritableAccount;
pub use solana_sdk::signature::Keypair;
pub use solana_sdk::signer::Signer;

/// Base training cost in atoms. With 100 the spec's examples hold exactly.
pub const BASE_TRAINING_COST: u64 = 100;
pub const APPROVED_TEMPLATE_ID: u32 = 7;
pub const APPROVED_TEMPLATE_URI_PREFIX: &str = "https://metadata.example.invalid/templates/7/";
/// A Pioneer's metadata file; other roles come from `member_uri`.
pub const MEMBER_URI: &str = "https://metadata.example.invalid/templates/7/013-pioneer.json";

/// The approved metadata URI of a citizen with `role` (D-0022 file naming).
pub fn member_uri(role: CitizenRole) -> String {
    format!(
        "{APPROVED_TEMPLATE_URI_PREFIX}013-{}.json",
        role.template().code_name
    )
}
pub const TOKEN_DECIMALS: u8 = 6;
pub const TOKEN_SUPPLY: u64 = 1_000_000_000;

/// Fixed clock so expiry checks are deterministic.
pub const NOW: i64 = 1_700_000_000;
pub const AN_HOUR: i64 = 3_600;
