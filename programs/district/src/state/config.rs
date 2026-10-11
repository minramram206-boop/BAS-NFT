use anchor_lang::prelude::*;

use crate::errors::DistrictError;

/// Singleton district configuration at PDA `["district_config"]` (SPEC §12).
#[account]
pub struct DistrictConfig {
    pub version: u8,
    pub admin: Pubkey,
    /// Named by `propose_admin`; `Pubkey::default()` when nothing is pending.
    pub pending_admin: Pubkey,
    /// Co-signs every `claim_training_credit` transaction.
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    /// Official Core collection. Not editable after initialization.
    pub collection_mint: Pubkey,
    /// `Pubkey::default()` until `set_utility_mint` runs.
    pub utility_mint: Pubkey,
    pub utility_mint_locked: bool,
    pub approved_template_id: u32,
    /// Token atoms; see `progression::training_cost_atoms`.
    pub base_training_cost: u64,
    pub total_registered_citizens: u32,
    pub is_paused: bool,
    pub bump: u8,
}

impl DistrictConfig {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // admin
        + 32 // pending_admin
        + 32 // mission_authority
        + 32 // sol_treasury
        + 32 // collection_mint
        + 32 // utility_mint
        + 1  // utility_mint_locked
        + 4  // approved_template_id
        + 8  // base_training_cost
        + 4  // total_registered_citizens
        + 1  // is_paused
        + 1; // bump

    pub fn has_utility_mint(&self) -> bool {
        self.utility_mint != Pubkey::default()
    }

    /// Shared by `initialize_config` and `update_config`: no empty address,
    /// and training can never be free.
    pub fn require_valid_parameters(
        mission_authority: &Pubkey,
        sol_treasury: &Pubkey,
        base_training_cost: u64,
    ) -> Result<()> {
        require!(
            *mission_authority != Pubkey::default()
                && *sol_treasury != Pubkey::default()
                && base_training_cost > 0,
            DistrictError::InvalidConfig
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(DistrictConfig::LEN, 8 + 1 + 32 * 6 + 1 + 4 + 8 + 4 + 1 + 1);
    }
}
