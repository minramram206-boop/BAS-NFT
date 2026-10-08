use anchor_lang::prelude::*;

/// Emitted whenever the district authority pauses or resumes the program.
///
/// The release sequence requires mainnet to launch paused and to be unpaused
/// only after the token binding, treasury, multisig, vault, and program
/// configuration are verified, so every transition is observable on chain.
#[event]
pub struct DistrictPausedChanged {
    /// District authority that signed the transition.
    pub authority: Pubkey,
    /// `true` when registration and training are blocked.
    pub paused: bool,
}

/// Emitted when a citizen registers, so indexers can follow the supply.
#[event]
pub struct CitizenRegistered {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub total_registered_citizens: u32,
}

/// Emitted after one atomic training transaction.
#[event]
pub struct StatTrained {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub stat: u8,
    pub new_score: u8,
    pub tokens_burned: u64,
    pub remaining_training_credits: u16,
}
