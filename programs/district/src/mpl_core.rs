//! Minimal reader for Metaplex Core asset accounts.
//!
//! `register_citizen` has to prove that the NFT being registered really belongs
//! to the district collection. Doing that without depending on the `mpl-core`
//! crate means reading the account bytes directly, so this module implements
//! exactly the slice of the Core layout that the check needs and nothing more.
//!
//! Layout of an uncompressed Core asset account (`AssetV1`), all borsh:
//!
//! ```text
//! offset  size  field
//! 0       1     key: Key                        (AssetV1 == 1)
//! 1       32    owner: Pubkey
//! 33      1     update_authority: variant tag   (Collection == 2)
//! 34      32    update_authority: collection pubkey
//! 66      4+n   name: String
//! ...     4+n   uri: String
//! ...     1|9   seq: Option<u64>
//! ...           optional plugin header / registry
//! ```
//!
//! Owner and collection live in the fixed-size prefix. `register_citizen` also
//! reads the Borsh `uri` string to compare it against the immutable approved
//! template registry; plugin data and `seq` are never parsed. The layout is
//! verified against `programs/mpl-core/src/state/asset.rs` and
//! `programs/mpl-core/src/state/update_authority.rs` in
//! github.com/metaplex-foundation/mpl-core.
//!
//! A compressed asset (`Key::HashedAssetV1`) stores no readable owner or
//! collection here, so it is rejected by the discriminator check. Supporting it
//! would need a Merkle tree and is tracked as a separate decision.

use anchor_lang::prelude::*;

use crate::errors::DistrictError;

/// Metaplex Core program address.
///
/// Taken from `MPL_CORE_PROGRAM_ID` in
/// `clients/js/src/generated/programs/mplCore.ts` of
/// github.com/metaplex-foundation/mpl-core. The check itself never trusts this
/// constant: callers pass the program account and Anchor verifies asset
/// ownership with `owner = mpl_core_program`, so a wrong constant here cannot
/// let a forged account through.
pub const MPL_CORE_PROGRAM_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/// `Key::AssetV1` — an uncompressed Core asset account.
pub const KEY_ASSET_V1: u8 = 1;

/// `Key::HashedAssetV1` — a compressed Core asset account.
pub const KEY_HASHED_ASSET_V1: u8 = 2;

/// `Key::CollectionV1` — a Core collection account, not an asset.
pub const KEY_COLLECTION_V1: u8 = 5;

/// `UpdateAuthority::Collection` — the asset delegates authority to a collection.
pub const UPDATE_AUTHORITY_COLLECTION: u8 = 2;

/// Byte offset of the asset owner inside an `AssetV1` account.
pub const OWNER_OFFSET: usize = 1;

/// Byte offset of the `UpdateAuthority` variant tag.
pub const UPDATE_AUTHORITY_TAG_OFFSET: usize = 33;

/// Byte offset of the collection pubkey when the variant is `Collection`.
pub const COLLECTION_OFFSET: usize = 34;

/// Shortest account that can still hold the whole fixed-size prefix.
pub const MIN_ASSET_PREFIX_LEN: usize = COLLECTION_OFFSET + 32;

/// The fixed-size prefix of a Metaplex Core `AssetV1` account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoreAssetPrefix {
    /// Owner of the asset, which is the holder rather than the creator.
    pub owner: Pubkey,
    /// Collection the asset belongs to, taken from `UpdateAuthority::Collection`.
    pub collection: Pubkey,
}

impl CoreAssetPrefix {
    /// True when the asset is a member of `expected_collection`.
    pub fn belongs_to_collection(&self, expected_collection: &Pubkey) -> bool {
        self.collection == *expected_collection
    }

    /// True when `holder` is the owner recorded on the asset.
    pub fn is_owned_by(&self, holder: &Pubkey) -> bool {
        self.owner == *holder
    }
}

/// Read the owner and collection out of a Core asset account.
///
/// Only the fixed-size prefix is inspected, so variable-length strings and
/// plugin data cannot shift the result. A truncated account fails closed.
pub fn read_core_asset_prefix(data: &[u8]) -> Result<CoreAssetPrefix> {
    // All three rejections report `InvalidAssetState`, the §13 error for an
    // account that is not a readable uncompressed Core asset. One variant
    // rather than three is deliberate: which check failed tells a caller
    // something about how the collection is built, and a client only needs to
    // know that the account is not usable. The three cases stay as three
    // separate tests below so a regression in any one of them is still caught.
    if data.len() < MIN_ASSET_PREFIX_LEN {
        return Err(error!(DistrictError::InvalidAssetState));
    }
    if data[0] != KEY_ASSET_V1 {
        return Err(error!(DistrictError::InvalidAssetState));
    }
    if data[UPDATE_AUTHORITY_TAG_OFFSET] != UPDATE_AUTHORITY_COLLECTION {
        return Err(error!(DistrictError::InvalidAssetState));
    }

    Ok(CoreAssetPrefix {
        owner: read_pubkey(data, OWNER_OFFSET),
        collection: read_pubkey(data, COLLECTION_OFFSET),
    })
}

/// Read the Borsh `uri` field from a Core asset, rejecting truncated lengths
/// and invalid UTF-8 instead of trusting attacker-controlled offsets.
pub fn read_core_asset_uri(data: &[u8]) -> Result<&str> {
    // Validate the discriminator and authority tag before interpreting a string.
    read_core_asset_prefix(data)?;
    let mut offset = MIN_ASSET_PREFIX_LEN;
    let _name = read_borsh_string(data, &mut offset)?;
    read_borsh_string(data, &mut offset)
}

fn read_borsh_string<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a str> {
    let length_end = (*offset)
        .checked_add(4)
        .ok_or_else(|| error!(DistrictError::InvalidAssetState))?;
    let length_bytes = data
        .get(*offset..length_end)
        .ok_or_else(|| error!(DistrictError::InvalidAssetState))?;
    let mut encoded_length = [0u8; 4];
    encoded_length.copy_from_slice(length_bytes);
    let length = u32::from_le_bytes(encoded_length) as usize;
    let value_start = length_end;
    let value_end = value_start
        .checked_add(length)
        .ok_or_else(|| error!(DistrictError::InvalidAssetState))?;
    let value = data
        .get(value_start..value_end)
        .ok_or_else(|| error!(DistrictError::InvalidAssetState))?;
    *offset = value_end;
    core::str::from_utf8(value).map_err(|_| error!(DistrictError::InvalidAssetState))
}

fn read_pubkey(data: &[u8], offset: usize) -> Pubkey {
    // Bounds are checked by `read_core_asset_prefix` before this is called.
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    Pubkey::new_from_array(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::error::Error as AnchorError;

    const OWNER: Pubkey = pubkey!("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    const COLLECTION: Pubkey = pubkey!("D8HGhXUqHx7UXysCMEBDzvd3FS4XGEMNjCR6Eaj8CRbV");
    const OTHER: Pubkey = pubkey!("6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG");

    /// Build an `AssetV1` account: the fixed prefix, then variable-length name,
    /// uri and seq exactly like borsh writes them, plus trailing plugin bytes.
    fn asset(
        key: u8,
        owner: &Pubkey,
        authority_tag: u8,
        authority: &Pubkey,
        name: &str,
        uri: &str,
    ) -> Vec<u8> {
        let mut data = Vec::new();
        data.push(key);
        data.extend_from_slice(owner.as_ref());
        data.push(authority_tag);
        data.extend_from_slice(authority.as_ref());
        for text in [name, uri] {
            data.extend_from_slice(&(text.len() as u32).to_le_bytes());
            data.extend_from_slice(text.as_bytes());
        }
        // seq: Option<u64> == Some(7)
        data.push(1);
        data.extend_from_slice(&7u64.to_le_bytes());
        // stand-in for a plugin header and registry
        data.extend_from_slice(&[0xAA; 64]);
        data
    }

    fn member_asset() -> Vec<u8> {
        asset(
            KEY_ASSET_V1,
            &OWNER,
            UPDATE_AUTHORITY_COLLECTION,
            &COLLECTION,
            "Citizen #13",
            "https://metadata.example.invalid/templates/7/citizen-13.json",
        )
    }

    /// The Anchor error name, so assertions stay readable.
    fn error_name<T>(result: Result<T>) -> String {
        match result.unwrap_err() {
            AnchorError::AnchorError(anchor_error) => anchor_error.error_name,
            AnchorError::ProgramError(program_error) => {
                format!("{:?}", program_error.program_error)
            },
        }
    }

    #[test]
    fn reads_owner_and_collection_from_a_member_asset() {
        let prefix = read_core_asset_prefix(&member_asset()).expect("a member asset must parse");
        assert_eq!(prefix.owner, OWNER);
        assert_eq!(prefix.collection, COLLECTION);
        assert!(prefix.belongs_to_collection(&COLLECTION));
        assert!(prefix.is_owned_by(&OWNER));
        assert!(!prefix.is_owned_by(&OTHER));
    }

    #[test]
    fn reads_the_variable_length_uri_for_template_validation() {
        assert_eq!(
            read_core_asset_uri(&member_asset()).expect("a valid URI must parse"),
            "https://metadata.example.invalid/templates/7/citizen-13.json"
        );
    }

    #[test]
    fn rejects_a_truncated_or_non_utf8_uri() {
        let valid = member_asset();
        let uri_length_offset = MIN_ASSET_PREFIX_LEN + 4 + "Citizen #13".len();
        let truncated = &valid[..uri_length_offset + 5];
        assert_eq!(error_name(read_core_asset_uri(truncated)), "InvalidAssetState");

        let mut invalid_utf8 = valid.clone();
        let uri_start = uri_length_offset + 4;
        invalid_utf8[uri_start] = 0xff;
        assert_eq!(error_name(read_core_asset_uri(&invalid_utf8)), "InvalidAssetState");
    }

    #[test]
    fn ignores_variable_length_name_uri_and_plugin_data() {
        // Prefix offsets must not move when name, uri or plugin bytes change.
        let long = asset(
            KEY_ASSET_V1,
            &OWNER,
            UPDATE_AUTHORITY_COLLECTION,
            &COLLECTION,
            &"n".repeat(300),
            &"u".repeat(900),
        );
        assert_eq!(
            read_core_asset_prefix(&long).expect("long name and uri must not matter").collection,
            COLLECTION
        );

        let empty = asset(KEY_ASSET_V1, &OWNER, UPDATE_AUTHORITY_COLLECTION, &COLLECTION, "", "");
        assert_eq!(
            read_core_asset_prefix(&empty).expect("empty strings must parse").owner,
            OWNER
        );
    }

    #[test]
    fn parses_but_does_not_accept_a_foreign_collection() {
        // The bytes are well-formed, so parsing succeeds; the caller compares
        // the collection against `config.collection_mint` and rejects it.
        let foreign = asset(
            KEY_ASSET_V1,
            &OWNER,
            UPDATE_AUTHORITY_COLLECTION,
            &OTHER,
            "Citizen #13",
            "https://metadata.example.invalid/templates/7/citizen-13.json",
        );
        let prefix = read_core_asset_prefix(&foreign).expect("well-formed bytes must parse");
        assert!(!prefix.belongs_to_collection(&COLLECTION));
        assert!(prefix.belongs_to_collection(&OTHER));
    }

    #[test]
    fn rejects_accounts_that_are_not_uncompressed_assets() {
        // 0 == Uninitialized, 2 == HashedAssetV1 (compressed), 5 == CollectionV1
        for key in [0u8, KEY_HASHED_ASSET_V1, KEY_COLLECTION_V1, 9, 255] {
            let data = asset(key, &OWNER, UPDATE_AUTHORITY_COLLECTION, &COLLECTION, "a", "b");
            assert_eq!(
                error_name(read_core_asset_prefix(&data)),
                "InvalidAssetState",
                "key {key} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_assets_whose_authority_is_not_a_collection() {
        // UpdateAuthority::None (0) and ::Address (1) mean the asset is
        // standalone, so it cannot be a member of the district collection.
        for tag in [0u8, 1, 3, 255] {
            let data = asset(KEY_ASSET_V1, &OWNER, tag, &OTHER, "a", "b");
            assert_eq!(
                error_name(read_core_asset_prefix(&data)),
                "InvalidAssetState",
                "update authority tag {tag} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_truncated_accounts() {
        let full = member_asset();
        for len in [0usize, 1, 33, 34, MIN_ASSET_PREFIX_LEN - 1] {
            assert_eq!(
                error_name(read_core_asset_prefix(&full[..len])),
                "InvalidAssetState",
                "a {len} byte account must be rejected"
            );
        }
        // The shortest accepted account is exactly the prefix.
        assert!(read_core_asset_prefix(&full[..MIN_ASSET_PREFIX_LEN]).is_ok());
    }

    #[test]
    fn offsets_match_the_documented_layout() {
        let data = member_asset();
        assert_eq!(data[0], KEY_ASSET_V1);
        assert_eq!(&data[OWNER_OFFSET..OWNER_OFFSET + 32], OWNER.as_ref());
        assert_eq!(data[UPDATE_AUTHORITY_TAG_OFFSET], UPDATE_AUTHORITY_COLLECTION);
        assert_eq!(&data[COLLECTION_OFFSET..COLLECTION_OFFSET + 32], COLLECTION.as_ref());
        // `AssetV1::BASE_LEN` in mpl-core is key + owner + authority tag +
        // authority pubkey + name length + uri length + seq option, with empty
        // strings; the prefix plus the two length fields plus the seq tag must
        // equal it.
        assert_eq!(MIN_ASSET_PREFIX_LEN + 4 + 4 + 1, 66 + 9);
    }

    #[test]
    fn mpl_core_program_id_is_the_published_address() {
        assert_eq!(
            MPL_CORE_PROGRAM_ID.to_string(),
            "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        );
    }
}
