//! Training economy rules (SPEC §5.3 and §7).

use crate::constants::{TIER_1_SCORE, TIER_2_SCORE, TIER_3_SCORE};
use crate::errors::DistrictError;
use anchor_lang::prelude::*;

/// Token atoms needed to raise a stat from `current_score` by one level:
/// training_cost = base_training_cost × (current_score + 1)
pub fn training_cost_atoms(base_training_cost: u64, current_score: u8) -> Result<u64> {
    let multiplier = u64::from(current_score) + 1;
    base_training_cost
        .checked_mul(multiplier)
        .ok_or_else(|| DistrictError::ArithmeticOverflow.into())
}

/// 0 below Tier 1, then 1, 2 and 3 at the §7 thresholds.
pub fn tier_for_score(score: u8) -> u8 {
    match score {
        s if s >= TIER_3_SCORE => 3,
        s if s >= TIER_2_SCORE => 2,
        s if s >= TIER_1_SCORE => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::STAT_MAX;

    #[test]
    fn stat_max_is_ten() {
        assert_eq!(STAT_MAX, 10);
    }

    #[test]
    fn tiers_follow_the_spec_thresholds() {
        let tiers: Vec<u8> = [0, 2, 3, 5, 6, 9, 10]
            .into_iter()
            .map(tier_for_score)
            .collect();
        assert_eq!(tiers, vec![0, 0, 1, 1, 2, 2, 3]);
    }

    #[test]
    fn cost_matches_the_spec_examples() {
        assert_eq!(training_cost_atoms(100, 0).unwrap(), 100);
        assert_eq!(training_cost_atoms(100, 1).unwrap(), 200);
        assert_eq!(training_cost_atoms(100, 8).unwrap(), 900);
        assert_eq!(training_cost_atoms(100, 9).unwrap(), 1_000);
    }

    #[test]
    fn cost_overflow_is_an_error() {
        assert!(matches!(
            training_cost_atoms(u64::MAX, 9),
            Err(err) if err == DistrictError::ArithmeticOverflow.into()
        ));
    }
}
