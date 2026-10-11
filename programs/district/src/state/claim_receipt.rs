use anchor_lang::prelude::*;

/// Marks one mission claim as used, at PDA
/// `["claim", asset, mission_id, nonce]`. Stores every field the claim was
/// bound to so it can be audited later.
#[account]
pub struct ClaimReceipt {
    pub version: u8,
    pub bump: u8,
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub mission_id: u64,
    pub season_id: u32,
    pub stat: u8,
    pub nonce: u64,
    pub expires_at: i64,
    pub claimed_at: i64,
}

impl ClaimReceipt {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 1  // bump
        + 32 // asset
        + 32 // owner
        + 8  // mission_id
        + 4  // season_id
        + 1  // stat
        + 8  // nonce
        + 8  // expires_at
        + 8; // claimed_at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(
            ClaimReceipt::LEN,
            8 + 1 + 1 + 32 + 32 + 8 + 4 + 1 + 8 + 8 + 8
        );
    }
}
