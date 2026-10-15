use anchor_lang::prelude::*;

use crate::constants::{MAX_FEE_BPS, MAX_ROYALTY_BPS};
use crate::errors::MarketError;

/// Singleton market configuration at PDA `["market-config"]`.
#[account]
pub struct MarketConfig {
    pub version: u8,
    pub admin: Pubkey,
    /// Named by `propose_admin`; `Pubkey::default()` when nothing is pending.
    pub pending_admin: Pubkey,
    /// The only Core collection this market trades. Not editable.
    pub collection: Pubkey,
    /// Must equal the collection's Royalties plugin (500 on devnet). The
    /// program does not read collection plugins, so `scripts/devnet` checks it.
    pub royalty_bps: u16,
    pub royalty_recipient: Pubkey,
    pub fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub is_paused: bool,
    pub bump: u8,
    pub authority_bump: u8,
}

impl MarketConfig {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // admin
        + 32 // pending_admin
        + 32 // collection
        + 2  // royalty_bps
        + 32 // royalty_recipient
        + 2  // fee_bps
        + 32 // fee_recipient
        + 1  // is_paused
        + 1  // bump
        + 1; // authority_bump

    /// Shared by `initialize_config` and `update_config`.
    ///
    /// Recipients are passed as accounts and must already hold enough SOL to
    /// stay rent exempt. A small royalty sent to an empty account would leave
    /// it below the rent minimum, and the runtime would fail the whole sale.
    pub fn require_valid_payouts<'info>(
        royalty_bps: u16,
        royalty_recipient: &AccountInfo<'info>,
        fee_bps: u16,
        fee_recipient: &AccountInfo<'info>,
    ) -> Result<()> {
        require!(
            royalty_bps <= MAX_ROYALTY_BPS && fee_bps <= MAX_FEE_BPS,
            MarketError::InvalidConfig
        );
        let minimum = Rent::get()?.minimum_balance(0);
        for recipient in [royalty_recipient, fee_recipient] {
            require_keys_neq!(
                *recipient.key,
                Pubkey::default(),
                MarketError::InvalidConfig
            );
            require!(
                recipient.lamports() >= minimum,
                MarketError::RecipientNotFunded
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(MarketConfig::LEN, 8 + 1 + 32 * 5 + 2 * 2 + 1 + 1 + 1);
    }
}
