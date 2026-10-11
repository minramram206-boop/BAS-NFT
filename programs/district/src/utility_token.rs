//! Validation of the official utility token mint.
//!
//! Both SPL Token and Token-2022 mints are accepted, because a Pump.fun coin
//! may be created on either program (D-0017). Everything else about training
//! goes through `anchor_spl::token_interface`, which handles both.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::StateWithExtensions, state::Mint as MintState,
};
use anchor_spl::{token, token_2022};

use crate::errors::DistrictError;

pub fn is_supported_token_program(program_id: &Pubkey) -> bool {
    *program_id == token::ID || *program_id == token_2022::ID
}

/// Facts about a mint that `set_utility_mint` records.
pub struct VerifiedMint {
    pub token_program: Pubkey,
    pub decimals: u8,
}

/// Verifies that `account` is an initialized mint owned by a supported token
/// program and has the decimals the config was priced for.
pub fn verify_utility_mint(account: &AccountInfo, expected_decimals: u8) -> Result<VerifiedMint> {
    require!(
        is_supported_token_program(account.owner),
        DistrictError::InvalidTokenProgram
    );

    let data = account.try_borrow_data()?;
    let mint = StateWithExtensions::<MintState>::unpack(&data)
        .map_err(|_| error!(DistrictError::InvalidUtilityMint))?;
    require!(mint.base.is_initialized, DistrictError::InvalidUtilityMint);
    require!(
        mint.base.decimals == expected_decimals,
        DistrictError::InvalidUtilityMint
    );

    Ok(VerifiedMint {
        token_program: *account.owner,
        decimals: mint.base.decimals,
    })
}
