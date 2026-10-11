//! Values the TypeScript packages mirror. Their own tests read the Rust
//! sources; this side pins the same numbers so a one-sided change fails here.

use district::constants::{STAT_MAX, TIER_1_SCORE, TIER_2_SCORE, TIER_3_SCORE};
use district::progression::training_cost_atoms;

use crate::harness::*;

#[test]
fn stat_role_and_cost_models_match_the_clients() {
    assert_eq!(STAT_MAX, 10);
    assert_eq!((TIER_1_SCORE, TIER_2_SCORE, TIER_3_SCORE), (3, 6, 10));

    assert_eq!(CitizenStat::Intelligence as u8, 0);
    assert_eq!(CitizenStat::Alignment as u8, 1);
    assert_eq!(CitizenStat::Compute as u8, 2);
    assert_eq!(
        [
            CitizenStat::Intelligence,
            CitizenStat::Alignment,
            CitizenStat::Compute
        ]
        .map(|s| s.public_label()),
        ["Insight", "Bond", "Craft"]
    );

    assert_eq!((ROLE_COUNT, ROLE_TEMPLATES.len()), (7, 7));
    assert_eq!(
        (CitizenRole::Pioneer as u8, CitizenRole::Mentor as u8),
        (0, 6)
    );

    assert_eq!(training_cost_atoms(BASE_TRAINING_COST, 1).unwrap(), 200);
    assert_eq!(training_cost_atoms(BASE_TRAINING_COST, 8).unwrap(), 900);
    assert_eq!(training_cost_atoms(BASE_TRAINING_COST, 9).unwrap(), 1_000);
}
