use anchor_lang::prelude::*;

/// One fixed-price offer to sell a citizen, at PDA `["listing", asset]`.
///
/// The asset stays in the seller's wallet. The listing only records the price
/// and who asked it; `buy` re-checks ownership and the delegate every time.
#[account]
pub struct Listing {
    pub version: u8,
    pub asset: Pubkey,
    /// Owner of the asset when it was listed, and recipient of the sale and
    /// of the rent when the listing closes.
    pub seller: Pubkey,
    pub price_lamports: u64,
    /// Unix time of `create_listing`; a price change keeps it.
    pub listed_at: i64,
    pub bump: u8,
}

impl Listing {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // asset
        + 32 // seller
        + 8  // price_lamports
        + 8  // listed_at
        + 1; // bump
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(Listing::LEN, 8 + 1 + 32 * 2 + 8 * 2 + 1);
    }
}
