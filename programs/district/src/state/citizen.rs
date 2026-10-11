use anchor_lang::prelude::*;

use crate::constants::{CREDITS_PER_UPGRADE, STAT_MAX};
use crate::errors::DistrictError;
use crate::progression::tier_for_score;

/// Canonical citizen progression at PDA `["citizen", asset]` (SPEC §6.4).
///
/// There is no owner field on purpose: ownership is read from the Core asset
/// on every call, so a transferred NFT is controlled by its new holder
/// without a migration.
#[account]
pub struct CitizenState {
    pub version: u8,
    pub bump: u8,
    pub citizen_id: u32,
    pub asset: Pubkey,
    pub role: u8,
    pub intelligence: u8,
    pub alignment: u8,
    pub compute: u8,
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

    pub fn score_of(&self, stat: CitizenStat) -> u8 {
        match stat {
            CitizenStat::Intelligence => self.intelligence,
            CitizenStat::Alignment => self.alignment,
            CitizenStat::Compute => self.compute,
        }
    }

    pub fn credits_of(&self, stat: CitizenStat) -> u16 {
        match stat {
            CitizenStat::Intelligence => self.insight_training_credits,
            CitizenStat::Alignment => self.bond_training_credits,
            CitizenStat::Compute => self.craft_training_credits,
        }
    }

    pub fn tier_of(&self, stat: CitizenStat) -> u8 {
        tier_for_score(self.score_of(stat))
    }

    /// Raises one stat by one level and returns the new score. Saturates at
    /// `STAT_MAX` so a missed bounds check can never wrap.
    pub fn raise(&mut self, stat: CitizenStat) -> u8 {
        let raised = self.score_of(stat).saturating_add(1).min(STAT_MAX);
        *self.score_mut(stat) = raised;
        raised
    }

    pub fn grant_credit(&mut self, stat: CitizenStat) -> Result<()> {
        let pool = self.credits_mut(stat);
        *pool = pool
            .checked_add(CREDITS_PER_UPGRADE)
            .ok_or(DistrictError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn consume_credit(&mut self, stat: CitizenStat) -> Result<()> {
        let pool = self.credits_mut(stat);
        *pool = pool
            .checked_sub(CREDITS_PER_UPGRADE)
            .ok_or(DistrictError::InsufficientTrainingCredits)?;
        Ok(())
    }

    fn score_mut(&mut self, stat: CitizenStat) -> &mut u8 {
        match stat {
            CitizenStat::Intelligence => &mut self.intelligence,
            CitizenStat::Alignment => &mut self.alignment,
            CitizenStat::Compute => &mut self.compute,
        }
    }

    fn credits_mut(&mut self, stat: CitizenStat) -> &mut u16 {
        match stat {
            CitizenStat::Intelligence => &mut self.insight_training_credits,
            CitizenStat::Alignment => &mut self.bond_training_credits,
            CitizenStat::Compute => &mut self.craft_training_credits,
        }
    }
}

/// A trainable attribute. Code names are fixed by SPEC §7; only the public
/// labels (Insight, Bond, Craft) appear in the UI.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CitizenStat {
    Intelligence = 0,
    Alignment = 1,
    Compute = 2,
}

impl CitizenStat {
    pub fn from_index(index: u8) -> Result<Self> {
        match index {
            0 => Ok(Self::Intelligence),
            1 => Ok(Self::Alignment),
            2 => Ok(Self::Compute),
            _ => Err(DistrictError::InvalidStat.into()),
        }
    }

    pub fn public_label(&self) -> &'static str {
        match self {
            Self::Intelligence => "Insight",
            Self::Alignment => "Bond",
            Self::Compute => "Craft",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CITIZEN_STATE_VERSION;

    fn citizen() -> CitizenState {
        CitizenState {
            version: CITIZEN_STATE_VERSION,
            bump: 0,
            citizen_id: 1,
            asset: Pubkey::new_unique(),
            role: 0,
            intelligence: 0,
            alignment: 0,
            compute: 0,
            insight_training_credits: 0,
            bond_training_credits: 0,
            craft_training_credits: 0,
        }
    }

    #[test]
    fn len_matches_the_field_list() {
        assert_eq!(
            CitizenState::LEN,
            8 + 1 + 1 + 4 + 32 + 1 + 1 + 1 + 1 + 2 + 2 + 2
        );
    }

    #[test]
    fn stat_indices_round_trip_and_unknown_ones_fail() {
        for index in 0..=2u8 {
            assert_eq!(CitizenStat::from_index(index).unwrap() as u8, index);
        }
        for index in [3u8, 255] {
            assert!(matches!(
                CitizenStat::from_index(index),
                Err(err) if err == DistrictError::InvalidStat.into()
            ));
        }
    }

    #[test]
    fn public_labels_are_insight_bond_and_craft() {
        assert_eq!(CitizenStat::Intelligence.public_label(), "Insight");
        assert_eq!(CitizenStat::Alignment.public_label(), "Bond");
        assert_eq!(CitizenStat::Compute.public_label(), "Craft");
    }

    #[test]
    fn credits_are_stat_specific_and_never_go_negative() {
        let mut citizen = citizen();
        citizen.insight_training_credits = 1;

        assert!(matches!(
            citizen.consume_credit(CitizenStat::Alignment),
            Err(err) if err == DistrictError::InsufficientTrainingCredits.into()
        ));
        assert_eq!(citizen.insight_training_credits, 1);

        citizen.consume_credit(CitizenStat::Intelligence).unwrap();
        assert_eq!(citizen.insight_training_credits, 0);
        assert!(citizen.consume_credit(CitizenStat::Intelligence).is_err());
    }

    #[test]
    fn granting_a_credit_refuses_to_overflow() {
        let mut citizen = citizen();
        citizen.craft_training_credits = u16::MAX;
        assert!(matches!(
            citizen.grant_credit(CitizenStat::Compute),
            Err(err) if err == DistrictError::ArithmeticOverflow.into()
        ));
        citizen.grant_credit(CitizenStat::Alignment).unwrap();
        assert_eq!(citizen.bond_training_credits, 1);
    }

    #[test]
    fn raising_saturates_at_the_maximum() {
        let mut citizen = citizen();
        citizen.intelligence = STAT_MAX - 1;
        assert_eq!(citizen.raise(CitizenStat::Intelligence), STAT_MAX);
        assert_eq!(citizen.raise(CitizenStat::Intelligence), STAT_MAX);
        assert_eq!(citizen.tier_of(CitizenStat::Intelligence), 3);
    }
}
