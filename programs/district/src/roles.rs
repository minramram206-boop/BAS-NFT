//! The seven-role registry (SPEC §6.3 and §8 Phase A, decisions D-0015 and
//! D-0022).
//!
//! A citizen's role is fixed by its metadata file name and `register_citizen`
//! takes the initial stats from here, never from the caller. Every role starts
//! with three points in total and below Tier 1, so the role changes the shape
//! of a citizen, not its strength.
//! `content/en/roles.json` and `packages/chain-client` mirror this table.

use crate::errors::DistrictError;
use anchor_lang::prelude::*;

pub const ROLE_COUNT: usize = 7;

/// A role and the stats a citizen of that role starts with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoleTemplate {
    /// Stored in `CitizenState::role`.
    pub index: u8,
    pub code_name: &'static str,
    pub public_label: &'static str,
    pub initial_intelligence: u8,
    pub initial_alignment: u8,
    pub initial_compute: u8,
}

/// The seven roles, in index order.
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

/// Looks a role up by index. Unknown roles are an error, never a default.
pub fn role_template(index: u8) -> Result<&'static RoleTemplate> {
    ROLE_TEMPLATES
        .iter()
        .find(|template| template.index == index)
        .ok_or_else(|| DistrictError::InvalidRole.into())
}

/// Reads the role out of an approved metadata file name (D-0022).
///
/// Files are named `<serial>-<role>.json`, for example `018-navigator.json`:
/// the role is the lowercase code name after the last `-`, and the serial in
/// front of it must not be empty.
pub fn role_from_metadata_file(file_name: &str) -> Result<&'static RoleTemplate> {
    let code_name = file_name
        .strip_suffix(".json")
        .and_then(|stem| stem.rsplit_once('-'))
        .filter(|(serial, _)| !serial.is_empty())
        .map(|(_, code_name)| code_name)
        .ok_or(DistrictError::InvalidRole)?;
    ROLE_TEMPLATES
        .iter()
        .find(|template| template.code_name == code_name)
        .ok_or_else(|| DistrictError::InvalidRole.into())
}

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

    pub fn template(&self) -> &'static RoleTemplate {
        &ROLE_TEMPLATES[*self as usize]
    }

    pub fn public_label(&self) -> &'static str {
        self.template().public_label
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{STAT_MAX, TIER_1_SCORE};

    #[test]
    fn the_registry_holds_exactly_seven_roles() {
        assert_eq!(
            ROLE_TEMPLATES.len(),
            7,
            "SPEC §8 Phase A: Seven role registry"
        );
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
            assert_eq!(
                total, 3,
                "{} starts with {total} points",
                template.code_name
            );
        }
    }

    #[test]
    fn no_role_starts_on_a_tier_boundary() {
        for template in ROLE_TEMPLATES.iter() {
            for score in [
                template.initial_intelligence,
                template.initial_alignment,
                template.initial_compute,
            ] {
                assert!(
                    score < TIER_1_SCORE,
                    "{} starts at a tier boundary",
                    template.code_name
                );
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
                template
                    .code_name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c == '_'),
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
    fn every_role_is_read_from_its_metadata_file_name() {
        for template in ROLE_TEMPLATES.iter() {
            let file_name = format!("018-{}.json", template.code_name);
            let found = role_from_metadata_file(&file_name).expect("a named role");
            assert_eq!(found.index, template.index, "{file_name}");
        }
        // The serial may contain dashes; only the last segment names the role.
        assert_eq!(
            role_from_metadata_file("s1-018-mentor.json")
                .unwrap()
                .code_name,
            "mentor"
        );
    }

    #[test]
    fn metadata_file_names_without_a_known_role_are_rejected() {
        for file_name in [
            "018.json",
            "navigator.json",
            "-navigator.json",
            "018-.json",
            "018-wizard.json",
            "018-Navigator.json",
            "018-navigator-2.json",
            "018-navigator.json.bak",
            "018-navigator",
            "",
        ] {
            assert!(
                matches!(
                    role_from_metadata_file(file_name),
                    Err(err) if err == DistrictError::InvalidRole.into()
                ),
                "{file_name:?} must not name a role"
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
            Err(err) if err == DistrictError::InvalidRole.into()
        ));
        assert!(matches!(
            CitizenRole::from_index(255),
            Err(err) if err == DistrictError::InvalidRole.into()
        ));
        assert!(matches!(
            role_template(ROLE_COUNT as u8),
            Err(err) if err == DistrictError::InvalidRole.into()
        ));
    }
}
