use anchor_lang::prelude::*;

/// The prize pool at PDA `["prize-vault"]`. It is owned by this program, so
/// only `claim` can take SOL out of it, and only to a published winner.
/// Anyone may send SOL to it; fee sharing does exactly that.
#[account]
pub struct PrizeVault {
    pub version: u8,
    pub bump: u8,
}

impl PrizeVault {
    pub const LEN: usize = 8 + 1 + 1;
}
