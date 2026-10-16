//! PDA addresses.

use anchor_lang::prelude::*;

use crate::constants::{AUCTION_SEED, AUTHORITY_SEED, CONFIG_SEED, LISTING_SEED, OFFER_SEED};

pub fn config_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID)
}

pub fn listing_address(asset: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[LISTING_SEED, asset.as_ref()], &crate::ID)
}

pub fn auction_address(asset: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUCTION_SEED, asset.as_ref()], &crate::ID)
}

pub fn offer_address(asset: &Pubkey, buyer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[OFFER_SEED, asset.as_ref(), buyer.as_ref()], &crate::ID)
}

pub fn authority_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUTHORITY_SEED], &crate::ID)
}

/// The authority PDA from the bump stored in the config, without the search
/// `find_program_address` does.
pub fn authority_from_bump(bump: u8) -> Result<Pubkey> {
    Pubkey::create_program_address(&[AUTHORITY_SEED, &[bump]], &crate::ID)
        .map_err(|_| error!(crate::errors::MarketError::InvalidConfig))
}
