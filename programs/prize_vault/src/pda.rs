//! PDA addresses.

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, SEASON_SEED, VAULT_SEED};

pub fn config_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID)
}

pub fn vault_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED], &crate::ID)
}

pub fn season_address(season_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEASON_SEED, &season_id.to_le_bytes()], &crate::ID)
}
