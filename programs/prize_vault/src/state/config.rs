use anchor_lang::prelude::*;

/// Singleton configuration at PDA `["prize-config"]`.
#[account]
pub struct PrizeConfig {
    pub version: u8,
    /// Funds seasons and publishes winners. A multisig on mainnet.
    pub authority: Pubkey,
    /// Named by `propose_authority`; `Pubkey::default()` when nothing is pending.
    pub pending_authority: Pubkey,
    /// Funding of seasons that is not yet paid out or rolled over. The vault
    /// holds at least this much above its rent; the rest is unallocated.
    pub reserved_lamports: u64,
    /// Everything ever paid to winners.
    pub paid_lamports: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl PrizeConfig {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // authority
        + 32 // pending_authority
        + 8  // reserved_lamports
        + 8  // paid_lamports
        + 1  // bump
        + 1; // vault_bump
}
