use anchor_lang::prelude::*;

/// Program errors, numbered from 6000 in declaration order. New variants go
/// at the end so existing codes keep their numbers; the web client maps them.
#[error_code]
pub enum PrizeError {
    #[msg("Caller is not authorized.")]
    Unauthorized,

    #[msg("Amount must be above zero.")]
    InvalidAmount,

    #[msg("The vault does not hold that much unallocated SOL.")]
    NotEnoughUnallocated,

    #[msg("The season end must be in the future.")]
    InvalidSeasonEnd,

    #[msg("A season keeps the end it was opened with.")]
    SeasonEndChanged,

    #[msg("The season has ended; it can no longer be funded.")]
    SeasonEnded,

    #[msg("The season has not ended yet.")]
    SeasonNotEnded,

    #[msg("Winners can no longer be changed: claims are open.")]
    ClaimsAlreadyOpen,

    #[msg("A season pays at most 35 winners, and prizes only with winners.")]
    InvalidWinnerCount,

    #[msg("The prizes add up to more than the season holds.")]
    PrizesOverFunding,

    #[msg("The season's winners are not published yet.")]
    NotFinalized,

    #[msg("Claims are not open yet.")]
    ClaimsNotOpen,

    #[msg("Winner index is outside the published list.")]
    InvalidIndex,

    #[msg("The proof does not match the published winners.")]
    InvalidProof,

    #[msg("This prize was already claimed.")]
    AlreadyClaimed,

    #[msg("The prize is larger than one winner may receive.")]
    PrizeTooLarge,

    #[msg("Claims would pay out more than the published prizes.")]
    ClaimsOverPrizes,

    #[msg("The season cannot roll over yet.")]
    RolloverNotReady,

    #[msg("The season's leftover funding was already released.")]
    AlreadyRolledOver,

    #[msg("No authority change is pending.")]
    NoPendingAuthority,

    #[msg("The proof is too long.")]
    ProofTooLong,

    #[msg("Arithmetic overflow.")]
    MathOverflow,
}
