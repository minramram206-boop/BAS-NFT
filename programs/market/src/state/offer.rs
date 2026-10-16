use anchor_lang::prelude::*;

/// A buyer's standing price for one citizen, at PDA `["offer", asset, buyer]`.
///
/// The offered SOL is held in this account's own lamports, on top of its
/// rent, until the owner accepts or the buyer takes it back. One buyer has at
/// most one offer per citizen; `make_offer` replaces the amount and the end.
/// Ownership is not recorded: whoever holds the citizen when the offer is
/// accepted is paid.
#[account]
pub struct Offer {
    pub version: u8,
    pub asset: Pubkey,
    /// Paid back on withdrawal or expiry, and receives the citizen on acceptance.
    pub buyer: Pubkey,
    pub amount_lamports: u64,
    /// Unix time of the latest `make_offer`.
    pub made_at: i64,
    /// From this time the offer can no longer be accepted.
    pub expires_at: i64,
    pub bump: u8,
}

impl Offer {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // asset
        + 32 // buyer
        + 8  // amount_lamports
        + 8  // made_at
        + 8  // expires_at
        + 1; // bump

    pub fn is_open(&self, now: i64) -> bool {
        now < self.expires_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(Offer::LEN, 8 + 1 + 32 * 2 + 8 * 3 + 1);
    }
}
