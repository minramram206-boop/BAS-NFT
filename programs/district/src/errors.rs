use anchor_lang::prelude::*;

/// Program errors, numbered from 6000 in declaration order.
///
/// Names follow SPEC §13. `AlreadyInitialized` and `CitizenAlreadyRegistered`
/// are not declared because the `init` constraint rejects those cases before
/// any handler runs; clients see the system program's `AccountAlreadyInUse`.
/// New variants go at the end so existing codes keep their numbers.
#[error_code]
pub enum DistrictError {
    #[msg("Caller is not authorized.")]
    Unauthorized,

    #[msg("District program is currently paused.")]
    ProgramPaused,

    #[msg("Utility mint has not been configured yet.")]
    UtilityMintNotSet,

    #[msg("Utility mint is locked and can no longer be changed.")]
    UtilityMintLocked,

    #[msg("The provided mint is not the bound utility token.")]
    InvalidUtilityMint,

    #[msg("Unsupported token program.")]
    InvalidTokenProgram,

    #[msg("Asset does not belong to the official collection.")]
    InvalidCollection,

    #[msg("Asset account is not a readable Core asset.")]
    InvalidAssetState,

    #[msg("Only the current owner can act on this citizen.")]
    NotOwner,

    #[msg("Unknown stat index.")]
    InvalidStat,

    #[msg("This stat has reached its maximum level.")]
    MaxScore,

    #[msg("No matching Training Credit available.")]
    InsufficientTrainingCredits,

    #[msg("Mission claim is not valid.")]
    InvalidMissionClaim,

    #[msg("Mission claim has expired.")]
    MissionClaimExpired,

    #[msg("Mission claim has already been used.")]
    MissionClaimAlreadyUsed,

    #[msg("Insufficient utility token balance.")]
    InsufficientTokenBalance,

    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,

    /// Not in §13: the role index is outside the seven-role registry.
    #[msg("Unknown citizen role.")]
    InvalidRole,

    /// Not in §13: unpausing and upgrading both require a locked mint (§5.2).
    #[msg("Utility mint must be locked first.")]
    UtilityMintNotLocked,

    /// Not in §13: an address is empty or the training cost is zero.
    #[msg("Configuration value is invalid.")]
    InvalidConfig,
}
