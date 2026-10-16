use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
    pub vault: Pubkey,
}

#[event]
pub struct SeasonFunded {
    pub season_id: u32,
    pub amount_lamports: u64,
    pub funded_lamports: u64,
    pub ends_at: i64,
}

#[event]
pub struct WinnersFinalized {
    pub season_id: u32,
    pub winners_root: [u8; 32],
    pub winners: u8,
    pub prizes_lamports: u64,
    pub claims_open_at: i64,
}

#[event]
pub struct PrizeClaimed {
    pub season_id: u32,
    pub index: u8,
    pub winner: Pubkey,
    pub amount_lamports: u64,
}

#[event]
pub struct SeasonRolledOver {
    pub season_id: u32,
    /// Funding no winner holds, free again for the next season.
    pub released_lamports: u64,
}

#[event]
pub struct AuthorityProposed {
    pub authority: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct AuthorityAccepted {
    pub previous: Pubkey,
    pub authority: Pubkey,
}
