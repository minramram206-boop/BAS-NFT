use anchor_lang::prelude::*;

#[error_code]
pub enum DistrictError {
    #[msg("District program is currently paused.")]
    ProgramPaused,
    #[msg("Caller is not the authorized owner of this citizen.")]
    UnauthorizedCitizenOwner,
    #[msg("Invalid utility token mint provided for burning.")]
    InvalidUtilityMint,
    #[msg("Insufficient training credits to perform this upgrade.")]
    InsufficientTrainingCredits,
    #[msg("Citizen stat has already reached maximum level (20).")]
    StatAlreadyMaxed,
    #[msg("Asset does not belong to the verified BAS District collection.")]
    InvalidCollection,
}
