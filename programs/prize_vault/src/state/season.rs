use anchor_lang::prelude::*;

/// One season's prize at PDA `["season", season_id as u32 LE]`.
///
/// Funded while the season runs; after it ends the authority publishes the
/// winners as a Merkle root, anyone can check them during the dispute window,
/// and then each winner claims their own prize.
#[account]
pub struct Season {
    pub version: u8,
    pub season_id: u32,
    /// Set aside for this season. Never lowered.
    pub funded_lamports: u64,
    /// Unix time the season ends; winners can be published from then on.
    pub ends_at: i64,
    /// Root of the winners tree; all zeros until published.
    pub winners_root: [u8; 32],
    pub winners: u8,
    /// Sum of all prizes in the tree.
    pub prizes_lamports: u64,
    /// Last time the winners were published; 0 until then.
    pub finalized_at: i64,
    /// From here on, each winner may claim, with no deadline.
    pub claims_open_at: i64,
    pub claimed_lamports: u64,
    /// Bit `i` is set once winner `i` has claimed.
    pub claimed_bitmap: u64,
    /// Set by `rollover` once the funding no winner holds went back to the pool.
    pub leftover_released: bool,
    pub bump: u8,
}

impl Season {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 4  // season_id
        + 8  // funded_lamports
        + 8  // ends_at
        + 32 // winners_root
        + 1  // winners
        + 8  // prizes_lamports
        + 8  // finalized_at
        + 8  // claims_open_at
        + 8  // claimed_lamports
        + 8  // claimed_bitmap
        + 1  // leftover_released
        + 1; // bump

    pub fn is_finalized(&self) -> bool {
        self.finalized_at != 0
    }

    pub fn has_claimed(&self, index: u8) -> bool {
        self.claimed_bitmap & (1u64 << index) != 0
    }

    /// Funding the published winners do not hold: pools with too few
    /// entries, rounding. It goes back to the pool at rollover; the prizes
    /// themselves stay reserved until their winners claim them.
    pub fn leftover_lamports(&self) -> u64 {
        self.funded_lamports.saturating_sub(self.prizes_lamports)
    }
}
