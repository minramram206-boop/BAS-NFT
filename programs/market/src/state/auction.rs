use anchor_lang::prelude::*;

use crate::core_asset::CoreAsset;

/// An English auction for one citizen, at PDA `["auction", asset]`.
///
/// The market's authority PDA holds the asset until the auction is settled
/// or cancelled (D-0092); older auctions froze it in the seller's wallet.
/// The highest bid is held in this account's own lamports, on top of its
/// rent; a higher bid pays the previous one back in the same instruction.
#[account]
pub struct Auction {
    pub version: u8,
    pub asset: Pubkey,
    pub seller: Pubkey,
    /// The first bid must be at least this.
    pub start_price_lamports: u64,
    /// Zero until the first bid.
    pub highest_bid_lamports: u64,
    /// `Pubkey::default()` until the first bid.
    pub highest_bidder: Pubkey,
    pub started_at: i64,
    /// Moves later when a bid arrives in the last `AUCTION_EXTENSION_SECONDS`.
    pub ends_at: i64,
    pub bid_count: u32,
    pub bump: u8,
}

impl Auction {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // asset
        + 32 // seller
        + 8  // start_price_lamports
        + 8  // highest_bid_lamports
        + 32 // highest_bidder
        + 8  // started_at
        + 8  // ends_at
        + 4  // bid_count
        + 1; // bump

    pub fn has_bids(&self) -> bool {
        self.bid_count > 0
    }

    /// The market holds the asset itself, as every auction started since the
    /// asset began to be handed over at the start (D-0092) does. Nobody can
    /// take it back then, so the auction always delivers.
    pub fn held_by_market(asset: &CoreAsset, authority: &Pubkey) -> bool {
        asset.owner == *authority
    }

    /// The market can still hand `asset` to a winner: it holds the asset, or,
    /// for an auction started before that (the asset frozen in the seller's
    /// wallet), the seller still holds it, frozen by the market, and the
    /// market may still transfer it. Core lets an owner revoke the
    /// TransferDelegate even while frozen, so only that older kind can turn
    /// undeliverable; bids stop then and settling pays them back.
    pub fn can_deliver(&self, asset: &CoreAsset, authority: &Pubkey) -> bool {
        Self::held_by_market(asset, authority)
            || (asset.owner == self.seller
                && asset.is_frozen()
                && asset.freeze_held_by(authority)
                && asset.delegates_transfer_to(authority))
    }
}

/// Moves lamports out of an account this program owns. The runtime checks
/// that the totals still match and that the source stays rent exempt.
pub fn move_lamports(from: &AccountInfo, to: &AccountInfo, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let mut source = from.try_borrow_mut_lamports()?;
    let mut target = to.try_borrow_mut_lamports()?;
    **source = source
        .checked_sub(lamports)
        .ok_or_else(|| error!(crate::errors::MarketError::Overflow))?;
    **target = target
        .checked_add(lamports)
        .ok_or_else(|| error!(crate::errors::MarketError::Overflow))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(Auction::LEN, 8 + 1 + 32 * 3 + 8 * 4 + 4 + 1);
    }
}
