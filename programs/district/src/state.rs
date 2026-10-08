use crate::errors::DistrictError;
use anchor_lang::prelude::*;

/// Layout version of [`CitizenState`].
///
/// Bumped whenever the serialized layout changes, so an indexer reading an old
/// account can tell instead of silently mis-decoding it. Required by
/// `PIXEL_DISTRICT_SPEC_V2_ID.md` §6.4.
pub const CITIZEN_STATE_VERSION: u8 = 1;

/// Layout version of [`DistrictConfig`].
pub const DISTRICT_CONFIG_VERSION: u8 = 1;

/// Maximum score of a single citizen stat.
///
/// `PIXEL_DISTRICT_SPEC_V2_ID.md` §7: "Maximum score: 10." Mirrored by
/// `STAT_MAX` in `packages/chain-client` and `MAX_STAT_SCORE` in
/// `packages/content`; those packages' tests fail when the values diverge.
pub const STAT_MAX: u8 = 10;

/// Score at which Tier 1 starts (§7).
pub const TIER_1_SCORE: u8 = 3;

/// Score at which Tier 2 starts (§7).
pub const TIER_2_SCORE: u8 = 6;

/// Score that is Tier 3 (§7). Equal to [`STAT_MAX`].
pub const TIER_3_SCORE: u8 = STAT_MAX;

/// One stat-specific Training Credit is consumed per upgrade, and credits can
/// only arrive through an authorized mission claim (§5.3, §12).
pub const CREDITS_PER_UPGRADE: u16 = 1;

/// The district configuration PDA.
///
/// Field set follows `PIXEL_DISTRICT_SPEC_V2_ID.md` §12 `initialize_config`:
/// admin, SOL treasury, collection, mission authority, economic parameters and
/// paused state. The utility mint is deliberately *not* part of initialization:
/// §12 gives it its own `set_utility_mint` and an irreversible
/// `lock_utility_mint`, because the official token comes from Pump.fun after
/// the program is already deployed (§5.7).
#[account]
pub struct DistrictConfig {
    pub version: u8,
    /// Current admin. Every privileged instruction checks this.
    pub admin: Pubkey,
    /// Set by `propose_admin`, cleared by `accept_admin`. Zero while there is
    /// no pending transfer, which is why `Pubkey::default()` is the empty
    /// marker rather than an `Option`: it keeps the layout fixed size.
    pub pending_admin: Pubkey,
    /// Signs authorized mission claims in `claim_training_credit`.
    pub mission_authority: Pubkey,
    /// Receives SOL mint payments (§15.2 acceptance test 5).
    pub sol_treasury: Pubkey,
    /// The official Metaplex Core collection every citizen must belong to.
    pub collection_mint: Pubkey,
    /// Zero means "not configured yet". `upgrade_score` refuses to run until
    /// this is set (§15.4 acceptance test 4).
    pub utility_mint: Pubkey,
    /// Set by `lock_utility_mint`; after that the mint can never change again.
    pub utility_mint_locked: bool,
    /// Template identifier every registered asset must carry (§6.3 item 3).
    pub approved_template_id: u32,
    /// `base_training_cost` in §5.3, in token atoms.
    pub base_training_cost: u64,
    pub total_registered_citizens: u32,
    /// Mainnet is deployed paused and only unpaused after the token binding,
    /// treasury, multisig, vault and program configuration are verified (§4 of
    /// `AGENT_START_HERE.md`).
    pub is_paused: bool,
    pub bump: u8,
}

impl DistrictConfig {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 32 // admin
        + 32 // pending_admin
        + 32 // mission_authority
        + 32 // sol_treasury
        + 32 // collection_mint
        + 32 // utility_mint
        + 1  // utility_mint_locked
        + 4  // approved_template_id
        + 8  // base_training_cost
        + 4  // total_registered_citizens
        + 1  // is_paused
        + 1; // bump
}

/// Canonical citizen progression state — the single source of truth for scores.
///
/// §6.4 marks this `[FINAL]`: "Hanya boleh ada satu sumber kebenaran untuk
/// skor." The field list is the one printed in that section, so it carries no
/// `owner`: ownership is whatever the Metaplex Core asset says right now, which
/// is what makes §15.3 acceptance test 14 (a transferred NFT can only be
/// trained by the new owner) true without a migration.
///
/// The Attributes plugin may mirror these scores for marketplaces, but it is
/// never read back as authority (§6.4).
#[account]
pub struct CitizenState {
    pub version: u8,
    pub bump: u8,
    /// 1-based registration number, from `DistrictConfig::total_registered_citizens`.
    pub citizen_id: u32,
    pub asset: Pubkey,
    pub role: u8,
    /// Public label `Insight` (§7).
    pub intelligence: u8,
    /// Public label `Bond` (§7).
    pub alignment: u8,
    /// Public label `Craft` (§7).
    pub compute: u8,
    /// Credits are stat-specific (§5.3): raising `intelligence` consumes an
    /// Insight credit, and an Insight credit cannot pay for Craft.
    pub insight_training_credits: u16,
    pub bond_training_credits: u16,
    pub craft_training_credits: u16,
}

impl CitizenState {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 1  // bump
        + 4  // citizen_id
        + 32 // asset
        + 1  // role
        + 1  // intelligence
        + 1  // alignment
        + 1  // compute
        + 2  // insight_training_credits
        + 2  // bond_training_credits
        + 2; // craft_training_credits

    /// The score of one stat, or `None` for an unknown index.
    pub fn score_of(&self, stat: CitizenStat) -> u8 {
        match stat {
            CitizenStat::Intelligence => self.intelligence,
            CitizenStat::Alignment => self.alignment,
            CitizenStat::Compute => self.compute,
        }
    }

    /// Raises one stat by exactly one level.
    ///
    /// Returns the new score. The caller has to have checked [`STAT_MAX`]
    /// first; this saturates rather than wrapping so a missed check can never
    /// produce a score above the maximum.
    pub fn raise(&mut self, stat: CitizenStat) -> u8 {
        let raised = self.score_of(stat).saturating_add(1).min(STAT_MAX);
        match stat {
            CitizenStat::Intelligence => self.intelligence = raised,
            CitizenStat::Alignment => self.alignment = raised,
            CitizenStat::Compute => self.compute = raised,
        }
        raised
    }

    /// Credits available for one stat.
    pub fn credits_of(&self, stat: CitizenStat) -> u16 {
        match stat {
            CitizenStat::Intelligence => self.insight_training_credits,
            CitizenStat::Alignment => self.bond_training_credits,
            CitizenStat::Compute => self.craft_training_credits,
        }
    }

    /// Consumes one credit for one stat, refusing to go negative.
    pub fn consume_credit(&mut self, stat: CitizenStat) -> Result<()> {
        let available = self.credits_of(stat);
        require!(
            available >= CREDITS_PER_UPGRADE,
            DistrictError::InsufficientTrainingCredits
        );
        let remaining = available - CREDITS_PER_UPGRADE;
        match stat {
            CitizenStat::Intelligence => self.insight_training_credits = remaining,
            CitizenStat::Alignment => self.bond_training_credits = remaining,
            CitizenStat::Compute => self.craft_training_credits = remaining,
        }
        Ok(())
    }

    /// Adds one credit for one stat, refusing to overflow the field.
    pub fn grant_credit(&mut self, stat: CitizenStat) -> Result<()> {
        let updated = self
            .credits_of(stat)
            .checked_add(CREDITS_PER_UPGRADE)
            .ok_or(DistrictError::ArithmeticOverflow)?;
        match stat {
            CitizenStat::Intelligence => self.insight_training_credits = updated,
            CitizenStat::Alignment => self.bond_training_credits = updated,
            CitizenStat::Compute => self.craft_training_credits = updated,
        }
        Ok(())
    }

    /// Tier of one stat, 1..=3 (§7).
    ///
    /// Kept on-chain next to the thresholds so a client cannot invent its own;
    /// `packages/chain-client` re-derives it and its test compares the two.
    pub fn tier_of(&self, stat: CitizenStat) -> u8 {
        tier_for_score(self.score_of(stat))
    }
}

/// Tier of a score: 1 below [`TIER_1_SCORE`], 2 from [`TIER_2_SCORE`], 3 at
/// [`TIER_3_SCORE`] (§7).
pub fn tier_for_score(score: u8) -> u8 {
    if score >= TIER_3_SCORE {
        3
    } else if score >= TIER_2_SCORE {
        2
    } else if score >= TIER_1_SCORE {
        1
    } else {
        0
    }
}

/// Layout version of [`ClaimReceipt`].
pub const CLAIM_RECEIPT_VERSION: u8 = 1;

/// Proof that one authorized mission claim was used (§12 `claim_training_credit`).
///
/// The account's address is derived from the asset, the mission ID and the
/// nonce, and creating it is what makes a signed claim single-use: presenting
/// the same claim again targets an account that already exists, which the
/// program reports as `MissionClaimAlreadyUsed` (§15.3 acceptance test 2).
///
/// Every field the spec binds the claim to is stored, so an auditor can check
/// after the fact that a credit was granted for the asset, stat, mission,
/// season, owner and nonce that were actually authorized.
#[account]
pub struct ClaimReceipt {
    pub version: u8,
    pub bump: u8,
    pub asset: Pubkey,
    /// The citizen's owner at claim time.
    pub owner: Pubkey,
    pub mission_id: u64,
    pub season_id: u32,
    /// 0 = Insight, 1 = Bond, 2 = Craft.
    pub stat: u8,
    pub nonce: u64,
    /// The expiry the claim was signed with.
    pub expires_at: i64,
    /// When the program accepted it, from the clock.
    pub claimed_at: i64,
}

impl ClaimReceipt {
    pub const LEN: usize = 8 // discriminator
        + 1  // version
        + 1  // bump
        + 32 // asset
        + 32 // owner
        + 8  // mission_id
        + 4  // season_id
        + 1  // stat
        + 8  // nonce
        + 8  // expires_at
        + 8; // claimed_at
}

/// A trainable citizen attribute (§7).
///
/// The internal code names are fixed by the spec — `intelligence`, `alignment`,
/// `compute` — while the public English labels are `Insight`, `Bond` and
/// `Craft`. Only the labels are user-facing; see `apps/web/src/messages/en.json`.
///
/// Discriminants are explicit so the on-chain encoding stays stable if a stat
/// is ever appended. Mirrored by `StatType` in `packages/chain-client`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CitizenStat {
    Intelligence = 0,
    Alignment = 1,
    Compute = 2,
}

impl CitizenStat {
    /// Rejects any byte that is not a known stat, so an unknown index becomes
    /// `InvalidStat` (§13) instead of being silently treated as one of these.
    pub fn from_index(index: u8) -> Result<Self> {
        match index {
            0 => Ok(CitizenStat::Intelligence),
            1 => Ok(CitizenStat::Alignment),
            2 => Ok(CitizenStat::Compute),
            _ => Err(DistrictError::InvalidStat.into()),
        }
    }

    /// The public English label from §7. On-chain so a client cannot drift.
    pub fn public_label(&self) -> &'static str {
        match self {
            CitizenStat::Intelligence => "Insight",
            CitizenStat::Alignment => "Bond",
            CitizenStat::Compute => "Craft",
        }
    }

    /// The credit kind that pays for this stat (§5.3).
    pub fn credit_kind(&self) -> &'static str {
        self.public_label()
    }
}

/// `training_cost = base_training_cost × (current_score + 1)` (§5.3).
///
/// All contract values are token atoms, never floating point. §15.3 acceptance
/// test 9 requires checked arithmetic, so an overflow is an error rather than a
/// wrapped cost that would undercharge the burn.
///
/// With `base = 100` atoms this reproduces the spec's own examples: a score of
/// 0 costs 100 to reach 1, and a score of 8 costs 900 to reach 9.
pub fn training_cost_atoms(base_training_cost: u64, current_score: u8) -> Result<u64> {
    let multiplier = u64::from(current_score)
        .checked_add(1)
        .ok_or(DistrictError::ArithmeticOverflow)?;
    base_training_cost
        .checked_mul(multiplier)
        .ok_or_else(|| DistrictError::ArithmeticOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_max_is_the_specified_ten() {
        assert_eq!(STAT_MAX, 10, "SPEC §7: Maximum score: 10");
    }

    #[test]
    fn tiers_follow_the_specified_thresholds() {
        assert_eq!(tier_for_score(0), 0);
        assert_eq!(tier_for_score(2), 0);
        assert_eq!(tier_for_score(3), 1, "Tier 1: score 3+");
        assert_eq!(tier_for_score(5), 1);
        assert_eq!(tier_for_score(6), 2, "Tier 2: score 6+");
        assert_eq!(tier_for_score(9), 2);
        assert_eq!(tier_for_score(10), 3, "Tier 3: score 10");
    }

    #[test]
    fn training_cost_follows_the_specified_formula() {
        // SPEC §5.3: training_cost = base_training_cost × (current_score + 1)
        assert_eq!(training_cost_atoms(100, 0).unwrap(), 100);
        assert_eq!(training_cost_atoms(100, 1).unwrap(), 200);
        assert_eq!(training_cost_atoms(100, 8).unwrap(), 900);
        assert_eq!(training_cost_atoms(100, 9).unwrap(), 1_000);
    }

    #[test]
    fn training_cost_rejects_overflow_instead_of_wrapping() {
        assert!(matches!(
            training_cost_atoms(u64::MAX, 9),
            Err(DistrictError::ArithmeticOverflow)
        ));
    }

    #[test]
    fn every_stat_index_round_trips_and_unknown_ones_are_rejected() {
        for index in 0..=2u8 {
            assert_eq!(CitizenStat::from_index(index).unwrap() as u8, index);
        }
        assert!(matches!(
            CitizenStat::from_index(3),
            Err(DistrictError::InvalidStat)
        ));
        assert!(matches!(
            CitizenStat::from_index(255),
            Err(DistrictError::InvalidStat)
        ));
    }

    #[test]
    fn public_labels_are_the_specified_english_words() {
        assert_eq!(CitizenStat::Intelligence.public_label(), "Insight");
        assert_eq!(CitizenStat::Alignment.public_label(), "Bond");
        assert_eq!(CitizenStat::Compute.public_label(), "Craft");
    }

    #[test]
    fn credits_are_stat_specific_and_cannot_go_negative() {
        let mut citizen = CitizenState {
            version: CITIZEN_STATE_VERSION,
            bump: 0,
            citizen_id: 1,
            asset: Pubkey::new_unique(),
            role: 0,
            intelligence: 0,
            alignment: 0,
            compute: 0,
            insight_training_credits: 1,
            bond_training_credits: 0,
            craft_training_credits: 0,
        };

        // An Insight credit cannot pay for Bond.
        assert!(matches!(
            citizen.consume_credit(CitizenStat::Alignment),
            Err(DistrictError::InsufficientTrainingCredits)
        ));
        assert_eq!(citizen.insight_training_credits, 1, "nothing was consumed");

        citizen.consume_credit(CitizenStat::Intelligence).unwrap();
        assert_eq!(citizen.insight_training_credits, 0);
        assert!(matches!(
            citizen.consume_credit(CitizenStat::Intelligence),
            Err(DistrictError::InsufficientTrainingCredits)
        ));
    }

    #[test]
    fn raising_a_stat_never_exceeds_the_maximum() {
        let mut citizen = CitizenState {
            version: CITIZEN_STATE_VERSION,
            bump: 0,
            citizen_id: 1,
            asset: Pubkey::new_unique(),
            role: 0,
            intelligence: STAT_MAX - 1,
            alignment: 0,
            compute: 0,
            insight_training_credits: 0,
            bond_training_credits: 0,
            craft_training_credits: 0,
        };

        assert_eq!(citizen.raise(CitizenStat::Intelligence), STAT_MAX);
        // A missing max check must saturate, not wrap to 0.
        assert_eq!(citizen.raise(CitizenStat::Intelligence), STAT_MAX);
        assert_eq!(citizen.tier_of(CitizenStat::Intelligence), 3);
    }

    #[test]
    fn account_lengths_match_their_field_lists() {
        // 8-byte Anchor discriminator plus every field, so a changed struct
        // without a changed LEN fails here rather than truncating on chain.
        assert_eq!(DistrictConfig::LEN, 8 + 1 + 32 * 6 + 1 + 4 + 8 + 4 + 1 + 1);
        assert_eq!(CitizenState::LEN, 8 + 1 + 1 + 4 + 32 + 1 + 1 + 1 + 1 + 2 + 2 + 2);
        assert_eq!(ClaimReceipt::LEN, 8 + 1 + 1 + 32 + 32 + 8 + 4 + 1 + 8 + 8 + 8);
    }
}
