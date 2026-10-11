use anchor_lang::prelude::*;

use crate::constants::MAX_APPROVED_TEMPLATE_URI_PREFIX_LEN;

/// Immutable metadata URI allowlist for one template id (D-0013).
///
/// Created together with the config and never updated, so the prefix it stores
/// is the only URI family `register_citizen` accepts.
#[account]
pub struct ApprovedTemplate {
    pub version: u8,
    pub bump: u8,
    pub template_id: u32,
    pub uri_prefix: String,
}

impl ApprovedTemplate {
    pub fn space(uri_prefix_len: usize) -> usize {
        8 // discriminator
            + 1 // version
            + 1 // bump
            + 4 // template_id
            + 4 // string length
            + uri_prefix_len
    }

    /// Accepts `<prefix><file>.json` where `<file>` is a single plain filename.
    pub fn approves_uri(&self, uri: &str) -> bool {
        self.approved_file_name(uri).is_some()
    }

    /// The metadata file name of an approved URI, `None` for any other URI.
    pub fn approved_file_name<'a>(&self, uri: &'a str) -> Option<&'a str> {
        let filename = uri.strip_prefix(&self.uri_prefix)?;
        let plain = !filename.is_empty()
            && filename.ends_with(".json")
            && !filename.contains("..")
            && filename
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        plain.then_some(filename)
    }

    /// An HTTPS prefix ending in `/templates/{template_id}/`, without
    /// credentials, query, fragment, whitespace or traversal.
    pub fn is_valid_uri_prefix(uri_prefix: &str, template_id: u32) -> bool {
        let expected_suffix = format!("/templates/{template_id}/");
        let Some(rest) = uri_prefix.strip_prefix("https://") else {
            return false;
        };
        let authority = rest.split('/').next().unwrap_or_default();

        uri_prefix.len() <= MAX_APPROVED_TEMPLATE_URI_PREFIX_LEN
            && uri_prefix.ends_with(&expected_suffix)
            && uri_prefix.is_ascii()
            && !uri_prefix
                .chars()
                .any(|c| c.is_whitespace() || matches!(c, '?' | '#' | '\\'))
            && !uri_prefix.contains("..")
            && !authority.is_empty()
            && !authority.contains('@')
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::APPROVED_TEMPLATE_VERSION;

    const PREFIX: &str = "https://metadata.example.invalid/templates/7/";

    #[test]
    fn prefix_must_be_https_and_name_its_template() {
        assert!(ApprovedTemplate::is_valid_uri_prefix(PREFIX, 7));

        let too_long = format!(
            "https://{}.invalid/templates/7/",
            "m".repeat(MAX_APPROVED_TEMPLATE_URI_PREFIX_LEN)
        );
        for bad in [
            "http://metadata.example.invalid/templates/7/",
            "https://metadata.example.invalid/templates/8/",
            "https://metadata.example.invalid/templates/7",
            "https://metadata.example.invalid/templates/7/?preview=true",
            "https://metadata.example.invalid/templates/7/#preview",
            "https://metadata.example.invalid/templates/7/ ",
            "https://méta.example.invalid/templates/7/",
            "https://user@metadata.example.invalid/templates/7/",
            "https://metadata.example.invalid/templates/7\\preview/templates/7/",
            "https:///templates/7/",
            too_long.as_str(),
        ] {
            assert!(
                !ApprovedTemplate::is_valid_uri_prefix(bad, 7),
                "accepted {bad}"
            );
        }
    }

    #[test]
    fn uri_must_be_one_json_file_under_the_prefix() {
        let template = ApprovedTemplate {
            version: APPROVED_TEMPLATE_VERSION,
            bump: 0,
            template_id: 7,
            uri_prefix: PREFIX.to_string(),
        };
        assert!(template.approves_uri(&format!("{PREFIX}citizen-13.json")));

        for uri in [
            "https://metadata.example.invalid/templates/8/citizen-13.json",
            PREFIX,
            "https://metadata.example.invalid/templates/7/citizen.png",
            "https://metadata.example.invalid/templates/7/subdir/citizen.json",
            "https://metadata.example.invalid/templates/7/../citizen.json",
            "https://metadata.example.invalid/templates/7/citizen.json?template=7",
            "https://metadata.example.invalid/templates/7/citizen.json#fragment",
            "https://metadata.example.invalid/templates/7/citizen name.json",
            "https://metadata.example.invalid/templates/7/citizen\\name.json",
            "https://metadata.example.invalid/templates/7/%2e%2e.json",
        ] {
            assert!(!template.approves_uri(uri), "accepted {uri}");
        }
    }

    #[test]
    fn space_counts_the_string_length_prefix() {
        assert_eq!(ApprovedTemplate::space(46), 8 + 1 + 1 + 4 + 4 + 46);
    }
}
