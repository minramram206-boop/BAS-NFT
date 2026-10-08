//! The citizen role registry (`PIXEL_DISTRICT_SPEC_V2_ID.md` §6.3 items 4 and
//! 6, §8 Phase A "Seven role registry").
//!
//! `register_citizen` reads a citizen's initial stats from here instead of
//! accepting them from the caller. That is the point: before this existed the
//! instruction took `initial_int`/`initial_aln`/`initial_cmp` as arguments, so
//! anyone registering their own NFT could simply pass `10, 10, 10` and start at
//! the maximum score without burning a single token. Initial stats are now a
//! property of the role, which the program picks, and progression past them
//! still costs tokens plus earned Training Credits.
//!
//! The spec fixes the *count* (seven) and the fact that stats depend on role,
//! but does not name the roles or their values. Those are chosen here and
//! recorded as D-0013, following §0: the simplest option that adds no feature.
//! Names are English because §1.3 requires it for code and identifiers, and
//! they are drawn from the occupations already present in
//! `content/en/citizens.json` so the roster and the registry describe the same
//! district.

use crate::errors::DistrictError;
use crate::state::STAT_MAX;
use anchor_lang::prelude::*;

/// How many roles the registry holds (§8 Phase A).
pub const ROLE_COUNT: usize = 7;

/// A role and the stats a citizen of that role starts with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoleTemplate {
    /// Stable on-chain index, also stored in `CitizenState::role`.
    pub index: u8,
    /// Internal code name (§1.3: identifiers are English).
    pub code_name: &'static str,
    /// Public English label shown in the UI (§7: no Indonesian in public UI).
    pub public_label: &'static str,
    /// Starting `intelligence` — public label Insight.
    pub initial_intelligence: u8,
    /// Starting `alignment` — public label Bond.
    pub initial_alignment: u8,
    /// Starting `compute` — public label Craft.
    pub initial_compute: u8,
}

/// The seven roles, in index order.
///
/// Every template grants exactly 3 points spread across the three stats, so no
/// role begins ahead of another in total score and the choice is about shape
/// rather than strength. No role starts at a tier boundary (§7 Tier 1 is 3+),
/// so the first upgrade always changes something a player can see.
pub const ROLE_TEMPLATES: [RoleTemplate; ROLE_COUNT] = [
    RoleTemplate {
        index: 0,
        code_name: "pioneer",
        public_label: "Pioneer",
        initial_intelligence: 1,
        initial_alignment: 1,
        initial_compute: 1,
    },
    RoleTemplate {
        index: 1,
        code_name: "steward",
        public_label: "Steward",
        initial_intelligence: 1,
        initial_alignment: 2,
        initial_compute: 0,
    },
    RoleTemplate {
        index: 2,
        code_name: "artisan",
        public_label: "Artisan",
        initial_intelligence: 0,
        initial_alignment: 1,
        initial_compute: 2,
    },
    RoleTemplate {
        index: 3,
        code_name: "sentinel",
        public_label: "Sentinel",
        initial_intelligence: 0,
        initial_alignment: 2,
        initial_compute: 1,
    },
    RoleTemplate {
        index: 4,
        code_name: "scholar",
        public_label: "Scholar",
        initial_intelligence: 2,
        initial_alignment: 1,
        initial_compute: 0,
    },
    RoleTemplate {
        index: 5,
        code_name: "navigator",
        public_label: "Navigator",
        initial_intelligence: 2,
        initial_alignment: 0,
        initial_compute: 1,
    },
    RoleTemplate {
        index: 6,
        code_name: "mentor",
        public_label: "Mentor",
        initial_intelligence: 1,
        initial_alignment: 0,
        initial_compute: 2,
    },
];

/// Looks a role up by its on-chain index.
///
/// An unknown index is an error rather than a fallback: §6.3 item 4 says the
/// template is read from the registry, so a role that is not in the registry
/// has no defined initial stats and must not be guessed.
pub fn role_template(index: u8) -> Result<&'static RoleTemplate> {
    ROLE_TEMPLATES
        .iter()
        .find(|template| template.index == index)
        .ok_or_else(|| DistrictError::InvalidRole.into())
}

/// A role as passed by a caller, checked before it is stored.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CitizenRole {
    Pioneer = 0,
    Steward = 1,
    Artisan = 2,
    Sentinel = 3,
    Scholar = 4,
    Navigator = 5,
    Mentor = 6,
}

impl CitizenRole {
    /// Rejects any byte that is not one of the seven roles.
    pub fn from_index(index: u8) -> Result<Self> {
        match index {
            0 => Ok(CitizenRole::Pioneer),
            1 => Ok(CitizenRole::Steward),
            2 => Ok(CitizenRole::Artisan),
            3 => Ok(CitizenRole::Sentinel),
            4 => Ok(CitizenRole::Scholar),
            5 => Ok(CitizenRole::Navigator),
            6 => Ok(CitizenRole::Mentor),
            _ => Err(DistrictError::InvalidRole.into()),
        }
    }

    /// The registry entry for this role.
    pub fn template(&self) -> &'static RoleTemplate {
        &ROLE_TEMPLATES[*self as usize]
    }

    /// Public English label (§7: the UI never shows an internal code name).
    pub fn public_label(&self) -> &'static str {
        self.template().public_label
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_registry_holds_exactly_seven_roles() {
        assert_eq!(ROLE_TEMPLATES.len(), 7, "SPEC §8 Phase A: Seven role registry");
        assert_eq!(ROLE_COUNT, 7);
    }

    #[test]
    fn indices_are_dense_and_match_the_position_in_the_registry() {
        for (position, template) in ROLE_TEMPLATES.iter().enumerate() {
            assert_eq!(
                usize::from(template.index),
                position,
                "{} is out of place",
                template.code_name
            );
        }
    }

    #[test]
    fn every_initial_stat_is_within_bounds_and_no_role_starts_maxed() {
        for template in ROLE_TEMPLATES.iter() {
            for score in [
                template.initial_intelligence,
                template.initial_alignment,
                template.initial_compute,
            ] {
                assert!(score <= STAT_MAX, "{} exceeds STAT_MAX", template.code_name);
                assert!(
                    score < STAT_MAX,
                    "{} would start at the maximum score",
                    template.code_name
                );
            }
        }
    }

    #[test]
    fn every_role_starts_from_the_same_total_so_none_is_ahead() {
        for template in ROLE_TEMPLATES.iter() {
            let total = u16::from(template.initial_intelligence)
                + u16::from(template.initial_alignment)
                + u16::from(template.initial_compute);
            assert_eq!(total, 3, "{} starts with {total} points", template.code_name);
        }
    }

    #[test]
    fn no_role_starts_on_a_tier_boundary() {
        // A first upgrade has to move the player past something visible (§7
        // Tier 1 starts at 3), so no starting score may already be 3.
        for template in ROLE_TEMPLATES.iter() {
            for score in [
                template.initial_intelligence,
                template.initial_alignment,
                template.initial_compute,
            ] {
                assert!(score < 3, "{} starts at a tier boundary", template.code_name);
            }
        }
    }

    #[test]
    fn code_names_and_labels_are_unique_and_english() {
        let mut code_names: Vec<&str> = ROLE_TEMPLATES.iter().map(|t| t.code_name).collect();
        let mut labels: Vec<&str> = ROLE_TEMPLATES.iter().map(|t| t.public_label).collect();
        let before = code_names.len();
        code_names.sort_unstable();
        code_names.dedup();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(code_names.len(), before, "duplicate code_name");
        assert_eq!(labels.len(), before, "duplicate public_label");

        for template in ROLE_TEMPLATES.iter() {
            assert!(
                template.code_name.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{} is not a lowercase identifier",
                template.code_name
            );
            assert!(
                template.public_label.is_ascii() && !template.public_label.is_empty(),
                "{} is not English ASCII",
                template.public_label
            );
        }
    }

    #[test]
    fn every_role_index_round_trips_and_unknown_ones_are_rejected() {
        for index in 0..ROLE_COUNT as u8 {
            let role = CitizenRole::from_index(index).expect("a known role");
            assert_eq!(role as u8, index);
            assert_eq!(role_template(index).expect("a template").index, index);
            assert_eq!(role.template().index, index);
        }
        assert!(matches!(
            CitizenRole::from_index(ROLE_COUNT as u8),
            Err(DistrictError::InvalidRole)
        ));
        assert!(matches!(
            CitizenRole::from_index(255),
            Err(DistrictError::InvalidRole)
        ));
        assert!(matches!(
            role_template(ROLE_COUNT as u8),
            Err(DistrictError::InvalidRole)
        ));
    }
}
