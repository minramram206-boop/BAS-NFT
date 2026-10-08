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
    #[msg("Citizen stat has already reached its maximum score.")]
    StatAlreadyMaxed,
    #[msg("Asset does not belong to the verified BAS District collection.")]
    InvalidCollection,
    #[msg("Asset account is too small to hold a Metaplex Core asset prefix.")]
    AssetAccountTooSmall,
    #[msg("Account is not an uncompressed Metaplex Core asset (Key::AssetV1).")]
    NotACoreAsset,
    #[msg("Asset update authority is not delegated to a collection.")]
    AssetNotInACollection,
    #[msg("Signer does not own the Metaplex Core asset being registered.")]
    NotAssetOwner,
    #[msg("Caller is not the district authority.")]
    UnauthorizedAuthority,
}
