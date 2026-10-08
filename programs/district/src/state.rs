use anchor_lang::prelude::*;

/// Maximum score of a single citizen stat.
/// Mirrored by `STAT_MAX` in `packages/chain-client` and `MAX_STAT_SCORE` in
/// `packages/content`; `packages/chain-client/test` fails when they diverge.
pub const STAT_MAX: u8 = 20;

/// Training Credits granted once, when a citizen is registered.
/// Credits can never be transferred or purchased.
pub const INITIAL_TRAINING_CREDITS: u16 = 1;

#[account]
pub struct DistrictConfig {
    pub authority: Pubkey,
    pub utility_mint: Pubkey,
    pub collection_mint: Pubkey,
    pub burn_amount_required: u64,
    pub total_registered_citizens: u32,
    pub is_paused: bool,
    pub bump: u8,
}

impl DistrictConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 4 + 1 + 1;
}

#[account]
pub struct CitizenState {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub intelligence: u8,
    pub alignment: u8,
    pub composure: u8,
    pub training_credits: u16,
    pub total_burns: u32,
    pub bump: u8,
}

impl CitizenState {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 1 + 2 + 4 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CitizenStat {
    Intelligence,
    Alignment,
    Composure,
}
