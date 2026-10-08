use anchor_lang::prelude::*;

/// Program errors.
///
/// The variant names are the ones listed in `PIXEL_DISTRICT_SPEC_V2_ID.md` §13,
/// so a client can map a code back to the spec by name. Two additions are
/// marked below: they cover rejections the spec requires (§6.3 item 3 template
/// verification, §6.3 item 4 role registry) but does not name an error for.
///
/// Anchor's `#[error_code]` numbers these from 6000 in declaration order, so
/// the order is part of the on-chain contract and must not be rearranged
/// without a migration.
#[error_code]
pub enum DistrictError {
    // --- §13, in the spec's order -------------------------------------------
    /// The signer is not the admin, or not the citizen's current owner where a
    /// more specific error does not apply.
    #[msg("Caller is not authorized.")]
    Unauthorized,

    /// Registration, upgrades and claims are blocked while paused.
    #[msg("District program is currently paused.")]
    ProgramPaused,

    // §13 also lists `AlreadyInitialized`. It is deliberately absent: the
    // `init` constraint on the config PDA is what refuses a second
    // initialization, and it does so before any handler runs, so no code of this
    // program can ever report it. Declaring a variant nothing can return would
    // be a lie in the error list. Anchor reports the case as its own
    // `AccountDiscriminatorAlreadySet` (3000), which the integration test
    // asserts.
    //
    // Removing a variant shifts every code below it, and these codes are part of
    // the on-chain contract. This is safe only because nothing has been
    // deployed; see D-0013.

    /// `upgrade_score` refuses to run before a utility mint is configured
    /// (§15.4 acceptance test 4).
    #[msg("Utility mint has not been configured yet.")]
    UtilityMintNotSet,

    /// The utility mint is permanently bound; `set_utility_mint` is closed.
    #[msg("Utility mint is locked and can no longer be changed.")]
    UtilityMintLocked,

    /// The mint passed in is not the one official utility token (§15.3 test 8).
    #[msg("The provided mint is not the bound utility token.")]
    InvalidUtilityMint,

    /// The token program is not the SPL Token program this program CPIs into.
    #[msg("Unsupported token program.")]
    InvalidTokenProgram,

    /// The asset's collection is not the official Core Collection (§15.3 test 7).
    #[msg("Asset does not belong to the official collection.")]
    InvalidCollection,

    /// The account is not a readable uncompressed Core asset, or its layout is
    /// not what the parser expects.
    #[msg("Asset account is not a readable Core asset.")]
    InvalidAssetState,

    // §13 also lists `CitizenAlreadyRegistered`, deliberately absent for the
    // same reason as `AlreadyInitialized`: the `init` constraint on the citizen
    // PDA refuses a second registration before any handler runs, so no code of
    // this program can report it. §15.3 does not name an expected error for that
    // case — unlike the mission-claim replay in acceptance test 2 — so the
    // framework's own code is acceptable there, and `claim_receipt` is the only
    // account this program creates by hand in order to report a §13 name.

    /// The signer is not the asset's current owner (§15.3 test 6).
    #[msg("Only the current owner can act on this citizen.")]
    NotOwner,

    /// The stat index is not one of the three known stats.
    #[msg("Unknown stat index.")]
    InvalidStat,

    /// The stat is already at `STAT_MAX` (§15.3 test 13).
    #[msg("This stat has reached its maximum level.")]
    MaxScore,

    /// No Training Credit of the matching kind (§15.3 test 4). Credits are
    /// stat-specific, so an Insight credit cannot pay for Craft.
    #[msg("No matching Training Credit available.")]
    InsufficientTrainingCredits,

    /// The mission claim is not signed by the mission authority, or its asset,
    /// stat, season or owner do not match the accounts presented.
    #[msg("Mission claim is not valid.")]
    InvalidMissionClaim,

    /// The claim's expiry has passed.
    #[msg("Mission claim has expired.")]
    MissionClaimExpired,

    /// The claim receipt PDA already exists, so this mission was already
    /// claimed (§15.3 test 2).
    #[msg("Mission claim has already been used.")]
    MissionClaimAlreadyUsed,

    /// The user's token balance cannot cover the training cost.
    #[msg("Insufficient utility token balance.")]
    InsufficientTokenBalance,

    /// A cost or counter calculation would overflow (§15.3 test 9).
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,

    // --- addition this program needs, not named in §13 ----------------------
    /// The role is not one of the seven in the registry (§6.3 item 4).
    /// Recorded in D-0013.
    ///
    /// §6.3 item 3, the approved template identifier, is also an addition, but
    /// it needs no variant of its own: it is a PDA derivation checked by
    /// Anchor's `seeds` constraint, so a wrong identifier is reported as the
    /// framework's `ConstraintSeeds` (2006) before any handler runs.
    #[msg("Unknown citizen role.")]
    InvalidRole,
}
