//! Minimal reader for Metaplex Core `AssetV1` accounts (D-0011).
//!
//! Only the fields the district needs are read, without depending on the
//! `mpl-core` crate:
//!
//! ```text
//! offset  size  field
//! 0       1     key                      (AssetV1 == 1)
//! 1       32    owner
//! 33      1     update_authority tag     (Collection == 2)
//! 34      32    collection
//! 66      4+n   name
//! ...     4+n   uri
//! ```
//!
//! The layout comes from `programs/mpl-core/src/state/asset.rs` in
//! github.com/metaplex-foundation/mpl-core. Compressed assets
//! (`HashedAssetV1`) carry no readable owner and are rejected.

use anchor_lang::prelude::*;

use crate::errors::DistrictError;

/// Metaplex Core program. Asset accounts must be owned by exactly this
/// address; a caller-supplied program id would let anyone forge an asset.
pub const MPL_CORE_PROGRAM_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

pub const KEY_ASSET_V1: u8 = 1;
pub const KEY_HASHED_ASSET_V1: u8 = 2;
pub const KEY_COLLECTION_V1: u8 = 5;
pub const UPDATE_AUTHORITY_COLLECTION: u8 = 2;

pub const OWNER_OFFSET: usize = 1;
pub const UPDATE_AUTHORITY_TAG_OFFSET: usize = 33;
pub const COLLECTION_OFFSET: usize = 34;
pub const MIN_ASSET_PREFIX_LEN: usize = COLLECTION_OFFSET + 32;

/// Owner and collection of an uncompressed Core asset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoreAssetPrefix {
    pub owner: Pubkey,
    pub collection: Pubkey,
}

impl CoreAssetPrefix {
    pub fn belongs_to_collection(&self, expected: &Pubkey) -> bool {
        self.collection == *expected
    }

    pub fn is_owned_by(&self, holder: &Pubkey) -> bool {
        self.owner == *holder
    }
}

/// Checks that `asset` is a Core asset in `collection` currently held by
/// `holder`. Every instruction that acts on a citizen goes through here.
pub fn load_collection_member(
    asset: &AccountInfo,
    collection: &Pubkey,
    holder: &Pubkey,
) -> Result<CoreAssetPrefix> {
    require_keys_eq!(
        *asset.owner,
        MPL_CORE_PROGRAM_ID,
        DistrictError::InvalidAssetState
    );
    let data = asset.try_borrow_data()?;
    let prefix = read_core_asset_prefix(&data)?;
    require!(
        prefix.belongs_to_collection(collection),
        DistrictError::InvalidCollection
    );
    require!(prefix.is_owned_by(holder), DistrictError::NotOwner);
    Ok(prefix)
}

/// Reads the fixed-size prefix. Fails closed on short or foreign data.
pub fn read_core_asset_prefix(data: &[u8]) -> Result<CoreAssetPrefix> {
    require!(
        data.len() >= MIN_ASSET_PREFIX_LEN
            && data[0] == KEY_ASSET_V1
            && data[UPDATE_AUTHORITY_TAG_OFFSET] == UPDATE_AUTHORITY_COLLECTION,
        DistrictError::InvalidAssetState
    );
    Ok(CoreAssetPrefix {
        owner: read_pubkey(data, OWNER_OFFSET),
        collection: read_pubkey(data, COLLECTION_OFFSET),
    })
}

/// Reads the borsh `uri` string that follows `name`.
pub fn read_core_asset_uri(data: &[u8]) -> Result<&str> {
    read_core_asset_prefix(data)?;
    let mut offset = MIN_ASSET_PREFIX_LEN;
    read_borsh_string(data, &mut offset)?; // name
    read_borsh_string(data, &mut offset)
}

fn read_borsh_string<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a str> {
    let invalid = || error!(DistrictError::InvalidAssetState);

    let len_end = offset.checked_add(4).ok_or_else(invalid)?;
    let len_bytes: [u8; 4] = data
        .get(*offset..len_end)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    let value_end = len_end
        .checked_add(u32::from_le_bytes(len_bytes) as usize)
        .ok_or_else(invalid)?;
    let value = data.get(len_end..value_end).ok_or_else(invalid)?;

    *offset = value_end;
    core::str::from_utf8(value).map_err(|_| invalid())
}

fn read_pubkey(data: &[u8], offset: usize) -> Pubkey {
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
    const URI: &str = "https://metadata.example.invalid/templates/7/citizen-13.json";

    fn asset(key: u8, tag: u8, authority: &Pubkey, name: &str, uri: &str) -> Vec<u8> {
        let mut data = vec![key];
        data.extend_from_slice(OWNER.as_ref());
        data.push(tag);
        data.extend_from_slice(authority.as_ref());
        for text in [name, uri] {
            data.extend_from_slice(&(text.len() as u32).to_le_bytes());
            data.extend_from_slice(text.as_bytes());
        }
        data.push(1); // seq: Some
        data.extend_from_slice(&7u64.to_le_bytes());
        data.extend_from_slice(&[0xAA; 64]); // plugin bytes
        data
    }

    fn member() -> Vec<u8> {
        asset(
            KEY_ASSET_V1,
            UPDATE_AUTHORITY_COLLECTION,
            &COLLECTION,
            "Citizen #13",
            URI,
        )
    }

    fn error_name<T: core::fmt::Debug>(result: Result<T>) -> String {
        match result.unwrap_err() {
            AnchorError::AnchorError(error) => error.error_name,
            AnchorError::ProgramError(error) => format!("{:?}", error.program_error),
        }
    }

    #[test]
    fn reads_owner_collection_and_uri() {
        let data = member();
        let prefix = read_core_asset_prefix(&data).unwrap();
        assert_eq!(
            prefix,
            CoreAssetPrefix {
                owner: OWNER,
                collection: COLLECTION
            }
        );
        assert!(prefix.is_owned_by(&OWNER) && !prefix.is_owned_by(&OTHER));
        assert_eq!(read_core_asset_uri(&data).unwrap(), URI);
    }

    #[test]
    fn variable_length_fields_do_not_move_the_prefix() {
        let long = asset(
            KEY_ASSET_V1,
            UPDATE_AUTHORITY_COLLECTION,
            &COLLECTION,
            &"n".repeat(300),
            &"u".repeat(900),
        );
        assert_eq!(
            read_core_asset_prefix(&long).unwrap().collection,
            COLLECTION
        );
        let empty = asset(
            KEY_ASSET_V1,
            UPDATE_AUTHORITY_COLLECTION,
            &COLLECTION,
            "",
            "",
        );
        assert_eq!(read_core_asset_prefix(&empty).unwrap().owner, OWNER);
    }

    #[test]
    fn foreign_collection_parses_but_does_not_match() {
        let data = asset(KEY_ASSET_V1, UPDATE_AUTHORITY_COLLECTION, &OTHER, "a", URI);
        assert!(!read_core_asset_prefix(&data)
            .unwrap()
            .belongs_to_collection(&COLLECTION));
    }

    #[test]
    fn rejects_non_asset_keys_and_standalone_assets() {
        for key in [0u8, KEY_HASHED_ASSET_V1, KEY_COLLECTION_V1, 9, 255] {
            let data = asset(key, UPDATE_AUTHORITY_COLLECTION, &COLLECTION, "a", "b");
            assert_eq!(
                error_name(read_core_asset_prefix(&data)),
                "InvalidAssetState"
            );
        }
        for tag in [0u8, 1, 3, 255] {
            let data = asset(KEY_ASSET_V1, tag, &OTHER, "a", "b");
            assert_eq!(
                error_name(read_core_asset_prefix(&data)),
                "InvalidAssetState"
            );
        }
    }

    #[test]
    fn rejects_truncated_prefixes_and_uris() {
        let data = member();
        for len in [0usize, 1, 33, 34, MIN_ASSET_PREFIX_LEN - 1] {
            assert_eq!(
                error_name(read_core_asset_prefix(&data[..len])),
                "InvalidAssetState"
            );
        }
        assert!(read_core_asset_prefix(&data[..MIN_ASSET_PREFIX_LEN]).is_ok());

        let uri_len_offset = MIN_ASSET_PREFIX_LEN + 4 + "Citizen #13".len();
        assert_eq!(
            error_name(read_core_asset_uri(&data[..uri_len_offset + 5])),
            "InvalidAssetState"
        );

        let mut bad_utf8 = data.clone();
        bad_utf8[uri_len_offset + 4] = 0xff;
        assert_eq!(
            error_name(read_core_asset_uri(&bad_utf8)),
            "InvalidAssetState"
        );
    }

    #[test]
    fn layout_constants_match_asset_v1() {
        // AssetV1::BASE_LEN = prefix + two empty strings + seq tag.
        assert_eq!(MIN_ASSET_PREFIX_LEN + 4 + 4 + 1, 75);
        assert_eq!(
            MPL_CORE_PROGRAM_ID.to_string(),
            "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        );
    }
}
