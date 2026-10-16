//! Reader for Metaplex Core `AssetV1` accounts and the two Core instructions
//! the market sends (`TransferV1`, and `UpdatePluginV1` to freeze or thaw),
//! built without the `mpl-core` crate (it needs a newer Solana than this
//! workspace's 1.18 toolchain).
//!
//! An uncompressed asset is the borsh `AssetV1`, optionally followed by
//! plugins:
//!
//! ```text
//! AssetV1          key=1, owner, update_authority, name, uri, seq: Option<u64>
//! PluginHeaderV1   key=3, plugin_registry_offset: u64     (right after AssetV1)
//! ...plugin data...
//! PluginRegistryV1 key=4, registry: Vec<RegistryRecord>, external_registry
//! RegistryRecord   plugin_type: u8, authority: Authority, offset: u64
//! Authority        None=0 | Owner=1 | UpdateAuthority=2 | Address=3 + Pubkey
//! ```
//!
//! Layouts come from `programs/mpl-core/src/state` and `src/plugins` in
//! github.com/metaplex-foundation/mpl-core, and are unchanged from release
//! 0.9.8 to 0.15. The integration tests in `programs/market/integration`
//! check this reader against assets written by Core itself.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};

use crate::errors::MarketError;

/// Asset accounts must be owned by exactly this program; a caller-supplied
/// program id would let anyone forge an asset.
pub const MPL_CORE_PROGRAM_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

pub const KEY_ASSET_V1: u8 = 1;
pub const KEY_PLUGIN_HEADER_V1: u8 = 3;
pub const KEY_PLUGIN_REGISTRY_V1: u8 = 4;
pub const UPDATE_AUTHORITY_COLLECTION: u8 = 2;

/// `PluginType::FreezeDelegate`, the second variant.
pub const PLUGIN_FREEZE_DELEGATE: u8 = 1;

/// `PluginType::TransferDelegate`, the fourth variant.
pub const PLUGIN_TRANSFER_DELEGATE: u8 = 3;

const AUTHORITY_NONE: u8 = 0;
const AUTHORITY_OWNER: u8 = 1;
const AUTHORITY_UPDATE_AUTHORITY: u8 = 2;
const AUTHORITY_ADDRESS: u8 = 3;

/// `MplAssetInstruction::TransferV1`, the fifteenth variant.
pub const TRANSFER_V1: u8 = 14;

/// `MplAssetInstruction::UpdatePluginV1`, the seventh variant.
pub const UPDATE_PLUGIN_V1: u8 = 6;

/// Who may use a plugin, as Core stores it in the registry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginAuthority {
    None,
    Owner,
    UpdateAuthority,
    Address(Pubkey),
}

/// A FreezeDelegate plugin: who may change it, and whether it holds the asset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FreezeState {
    pub authority: PluginAuthority,
    pub frozen: bool,
}

/// The parts of a collection asset the market acts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoreAsset {
    pub owner: Pubkey,
    pub collection: Pubkey,
    /// Authority of the TransferDelegate plugin, `None` when the asset has none.
    pub transfer_delegate: Option<PluginAuthority>,
    /// The FreezeDelegate plugin, `None` when the asset has none.
    pub freeze_delegate: Option<FreezeState>,
}

impl CoreAsset {
    pub fn delegates_transfer_to(&self, delegate: &Pubkey) -> bool {
        self.transfer_delegate == Some(PluginAuthority::Address(*delegate))
    }

    /// Frozen by anyone. Core then refuses every transfer and burn.
    pub fn is_frozen(&self) -> bool {
        self.freeze_delegate.is_some_and(|freeze| freeze.frozen)
    }

    /// `delegate` holds the FreezeDelegate plugin, frozen or not.
    pub fn freeze_held_by(&self, delegate: &Pubkey) -> bool {
        self.freeze_delegate
            .is_some_and(|freeze| freeze.authority == PluginAuthority::Address(*delegate))
    }
}

/// True when `account` holds a live uncompressed Core asset. A burned asset
/// keeps a one-byte account with key `Uninitialized`, so this is false for it.
pub fn is_live_asset(account: &AccountInfo) -> bool {
    account.owner == &MPL_CORE_PROGRAM_ID
        && account
            .try_borrow_data()
            .map(|data| data.first() == Some(&KEY_ASSET_V1))
            .unwrap_or(false)
}

/// Reads a Core asset owned by the Core program. Fails closed on anything
/// that is not an uncompressed asset whose update authority is a collection.
pub fn load_core_asset(account: &AccountInfo) -> Result<CoreAsset> {
    require_keys_eq!(
        *account.owner,
        MPL_CORE_PROGRAM_ID,
        MarketError::InvalidAsset
    );
    let data = account.try_borrow_data()?;
    read_core_asset(&data)
}

pub fn read_core_asset(data: &[u8]) -> Result<CoreAsset> {
    parse(data).ok_or_else(|| error!(MarketError::InvalidAsset))
}

fn parse(data: &[u8]) -> Option<CoreAsset> {
    let mut reader = Reader { data, offset: 0 };
    if reader.u8()? != KEY_ASSET_V1 {
        return None;
    }
    let owner = reader.pubkey()?;
    if reader.u8()? != UPDATE_AUTHORITY_COLLECTION {
        return None;
    }
    let collection = reader.pubkey()?;
    reader.skip_string()?; // name
    reader.skip_string()?; // uri
    match reader.u8()? {
        0 => {}
        1 => reader.skip(8)?,
        _ => return None,
    }

    let (transfer_delegate, freeze_delegate) = if reader.offset == data.len() {
        (None, None)
    } else {
        read_plugins(data, reader.offset)?
    };

    Some(CoreAsset {
        owner,
        collection,
        transfer_delegate,
        freeze_delegate,
    })
}

/// The TransferDelegate and FreezeDelegate plugins in the registry behind the
/// header at `header_offset`. `None` means the bytes are malformed.
#[allow(clippy::type_complexity)]
fn read_plugins(
    data: &[u8],
    header_offset: usize,
) -> Option<(Option<PluginAuthority>, Option<FreezeState>)> {
    let mut header = Reader {
        data,
        offset: header_offset,
    };
    if header.u8()? != KEY_PLUGIN_HEADER_V1 {
        return None;
    }
    let registry_offset = usize::try_from(header.u64()?).ok()?;

    let mut registry = Reader {
        data,
        offset: registry_offset,
    };
    if registry.u8()? != KEY_PLUGIN_REGISTRY_V1 {
        return None;
    }
    let mut transfer = None;
    let mut freeze = None;
    for _ in 0..registry.u32()? {
        let record_type = registry.u8()?;
        let authority = match registry.u8()? {
            AUTHORITY_NONE => PluginAuthority::None,
            AUTHORITY_OWNER => PluginAuthority::Owner,
            AUTHORITY_UPDATE_AUTHORITY => PluginAuthority::UpdateAuthority,
            AUTHORITY_ADDRESS => PluginAuthority::Address(registry.pubkey()?),
            _ => return None,
        };
        let plugin_offset = usize::try_from(registry.u64()?).ok()?;
        if record_type == PLUGIN_TRANSFER_DELEGATE && transfer.is_none() {
            transfer = Some(authority);
        }
        if record_type == PLUGIN_FREEZE_DELEGATE && freeze.is_none() {
            // The plugin is the borsh `Plugin` enum: its tag, then `FreezeDelegate { frozen: bool }`.
            let mut body = Reader {
                data,
                offset: plugin_offset,
            };
            if body.u8()? != PLUGIN_FREEZE_DELEGATE {
                return None;
            }
            let frozen = match body.u8()? {
                0 => false,
                1 => true,
                _ => return None,
            };
            freeze = Some(FreezeState { authority, frozen });
        }
    }
    registry.u32()?; // external_registry length; its records are not needed
    Some((transfer, freeze))
}

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(len)?;
        let bytes = self.data.get(self.offset..end)?;
        self.offset = end;
        Some(bytes)
    }

    fn skip(&mut self, len: usize) -> Option<()> {
        self.take(len).map(|_| ())
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|bytes| bytes[0])
    }

    fn u32(&mut self) -> Option<u32> {
        self.take(4)?.try_into().ok().map(u32::from_le_bytes)
    }

    fn u64(&mut self) -> Option<u64> {
        self.take(8)?.try_into().ok().map(u64::from_le_bytes)
    }

    fn pubkey(&mut self) -> Option<Pubkey> {
        let bytes: [u8; 32] = self.take(32)?.try_into().ok()?;
        Some(Pubkey::new_from_array(bytes))
    }

    fn skip_string(&mut self) -> Option<()> {
        let len = usize::try_from(self.u32()?).ok()?;
        self.skip(len)
    }
}

/// Accounts of a Core `TransferV1` sent by the market as transfer delegate.
pub struct TransferAccounts<'a, 'info> {
    pub core_program: &'a AccountInfo<'info>,
    pub asset: &'a AccountInfo<'info>,
    pub collection: &'a AccountInfo<'info>,
    pub payer: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub new_owner: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
}

/// `TransferV1` with no compression proof. Account order follows the
/// instruction's shank attributes; the unused optional `log_wrapper` slot
/// carries the Core program id, which is how Core reads "absent".
pub fn transfer_instruction(
    asset: &Pubkey,
    collection: &Pubkey,
    payer: &Pubkey,
    authority: &Pubkey,
    new_owner: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: MPL_CORE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*asset, false),
            AccountMeta::new_readonly(*collection, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*new_owner, false),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(MPL_CORE_PROGRAM_ID, false),
        ],
        // TransferV1Args { compression_proof: None }
        data: vec![TRANSFER_V1, 0],
    }
}

pub fn transfer(accounts: TransferAccounts, authority_seeds: &[&[u8]]) -> Result<()> {
    require_keys_eq!(
        *accounts.core_program.key,
        MPL_CORE_PROGRAM_ID,
        MarketError::InvalidAsset
    );
    let instruction = transfer_instruction(
        accounts.asset.key,
        accounts.collection.key,
        accounts.payer.key,
        accounts.authority.key,
        accounts.new_owner.key,
    );
    invoke_signed(
        &instruction,
        &[
            accounts.asset.clone(),
            accounts.collection.clone(),
            accounts.payer.clone(),
            accounts.authority.clone(),
            accounts.new_owner.clone(),
            accounts.system_program.clone(),
            accounts.core_program.clone(),
        ],
        &[authority_seeds],
    )?;
    Ok(())
}

/// `TransferV1` signed by a wallet that signed the whole transaction, such as
/// a seller handing a citizen to the market. No program seeds are involved.
pub fn transfer_by_signer(accounts: TransferAccounts) -> Result<()> {
    require_keys_eq!(
        *accounts.core_program.key,
        MPL_CORE_PROGRAM_ID,
        MarketError::InvalidAsset
    );
    let instruction = transfer_instruction(
        accounts.asset.key,
        accounts.collection.key,
        accounts.payer.key,
        accounts.authority.key,
        accounts.new_owner.key,
    );
    invoke(
        &instruction,
        &[
            accounts.asset.clone(),
            accounts.collection.clone(),
            accounts.payer.clone(),
            accounts.authority.clone(),
            accounts.new_owner.clone(),
            accounts.system_program.clone(),
            accounts.core_program.clone(),
        ],
    )?;
    Ok(())
}

/// Accounts of a Core `UpdatePluginV1` sent by the market as FreezeDelegate authority.
pub struct FreezeAccounts<'a, 'info> {
    pub core_program: &'a AccountInfo<'info>,
    pub asset: &'a AccountInfo<'info>,
    pub collection: &'a AccountInfo<'info>,
    pub payer: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
}

/// `UpdatePluginV1` setting the FreezeDelegate plugin to `frozen`.
pub fn set_frozen_instruction(
    asset: &Pubkey,
    collection: &Pubkey,
    payer: &Pubkey,
    authority: &Pubkey,
    frozen: bool,
) -> Instruction {
    Instruction {
        program_id: MPL_CORE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*asset, false),
            AccountMeta::new(*collection, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(MPL_CORE_PROGRAM_ID, false),
        ],
        // UpdatePluginV1Args { plugin: Plugin::FreezeDelegate(FreezeDelegate { frozen }) }
        data: vec![UPDATE_PLUGIN_V1, PLUGIN_FREEZE_DELEGATE, u8::from(frozen)],
    }
}

pub fn set_frozen(accounts: FreezeAccounts, frozen: bool, authority_seeds: &[&[u8]]) -> Result<()> {
    require_keys_eq!(
        *accounts.core_program.key,
        MPL_CORE_PROGRAM_ID,
        MarketError::InvalidAsset
    );
    let instruction = set_frozen_instruction(
        accounts.asset.key,
        accounts.collection.key,
        accounts.payer.key,
        accounts.authority.key,
        frozen,
    );
    invoke_signed(
        &instruction,
        &[
            accounts.asset.clone(),
            accounts.collection.clone(),
            accounts.payer.clone(),
            accounts.authority.clone(),
            accounts.system_program.clone(),
            accounts.core_program.clone(),
        ],
        &[authority_seeds],
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const OWNER: Pubkey = pubkey!("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    pub const COLLECTION: Pubkey = pubkey!("D8HGhXUqHx7UXysCMEBDzvd3FS4XGEMNjCR6Eaj8CRbV");
    pub const DELEGATE: Pubkey = pubkey!("6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG");

    /// Bytes laid out as Core writes them: asset, then (when `plugins` is not
    /// empty) a header, one byte of plugin data per record, and the registry.
    pub fn asset_bytes(seq: Option<u64>, plugins: &[(u8, PluginAuthority)]) -> Vec<u8> {
        let mut data = vec![KEY_ASSET_V1];
        data.extend_from_slice(OWNER.as_ref());
        data.push(UPDATE_AUTHORITY_COLLECTION);
        data.extend_from_slice(COLLECTION.as_ref());
        for text in ["Citizen #13", "https://example.invalid/13.json"] {
            data.extend_from_slice(&(text.len() as u32).to_le_bytes());
            data.extend_from_slice(text.as_bytes());
        }
        match seq {
            Some(value) => {
                data.push(1);
                data.extend_from_slice(&value.to_le_bytes());
            }
            None => data.push(0),
        }
        if plugins.is_empty() {
            return data;
        }

        let header_offset = data.len();
        data.push(KEY_PLUGIN_HEADER_V1);
        data.extend_from_slice(&0u64.to_le_bytes()); // patched below
        let plugin_offsets: Vec<u64> = plugins
            .iter()
            .map(|(plugin_type, _)| {
                let offset = data.len() as u64;
                data.push(*plugin_type); // stand-in plugin body: the enum tag
                if *plugin_type == PLUGIN_FREEZE_DELEGATE {
                    data.push(0); // FreezeDelegate { frozen: false }
                }
                offset
            })
            .collect();

        let registry_offset = data.len() as u64;
        data[header_offset + 1..header_offset + 9].copy_from_slice(&registry_offset.to_le_bytes());
        data.push(KEY_PLUGIN_REGISTRY_V1);
        data.extend_from_slice(&(plugins.len() as u32).to_le_bytes());
        for ((plugin_type, authority), offset) in plugins.iter().zip(plugin_offsets) {
            data.push(*plugin_type);
            match authority {
                PluginAuthority::None => data.push(AUTHORITY_NONE),
                PluginAuthority::Owner => data.push(AUTHORITY_OWNER),
                PluginAuthority::UpdateAuthority => data.push(AUTHORITY_UPDATE_AUTHORITY),
                PluginAuthority::Address(key) => {
                    data.push(AUTHORITY_ADDRESS);
                    data.extend_from_slice(key.as_ref());
                }
            }
            data.extend_from_slice(&offset.to_le_bytes());
        }
        data.extend_from_slice(&0u32.to_le_bytes()); // external_registry
        data
    }

    fn invalid(result: Result<CoreAsset>) -> bool {
        matches!(
            result,
            Err(anchor_lang::error::Error::AnchorError(ref error))
                if error.error_name == "InvalidAsset"
        )
    }

    #[test]
    fn reads_an_asset_without_plugins() {
        for seq in [None, Some(7)] {
            let asset = read_core_asset(&asset_bytes(seq, &[])).unwrap();
            assert_eq!(asset.owner, OWNER);
            assert_eq!(asset.collection, COLLECTION);
            assert_eq!(asset.transfer_delegate, None);
            assert!(!asset.delegates_transfer_to(&DELEGATE));
        }
    }

    #[test]
    fn finds_the_transfer_delegate_among_other_plugins() {
        let plugins = [
            (1, PluginAuthority::Owner), // FreezeDelegate
            (PLUGIN_TRANSFER_DELEGATE, PluginAuthority::Address(DELEGATE)),
            (6, PluginAuthority::UpdateAuthority), // Attributes
        ];
        for seq in [None, Some(3)] {
            let asset = read_core_asset(&asset_bytes(seq, &plugins)).unwrap();
            assert_eq!(
                asset.transfer_delegate,
                Some(PluginAuthority::Address(DELEGATE))
            );
            assert!(asset.delegates_transfer_to(&DELEGATE));
            assert!(!asset.delegates_transfer_to(&OWNER));
        }
    }

    #[test]
    fn a_reset_or_missing_delegate_is_not_the_market() {
        let reset = asset_bytes(None, &[(PLUGIN_TRANSFER_DELEGATE, PluginAuthority::Owner)]);
        let asset = read_core_asset(&reset).unwrap();
        assert_eq!(asset.transfer_delegate, Some(PluginAuthority::Owner));
        assert!(!asset.delegates_transfer_to(&DELEGATE));

        let other = asset_bytes(None, &[(1, PluginAuthority::Address(DELEGATE))]);
        assert_eq!(read_core_asset(&other).unwrap().transfer_delegate, None);
    }

    #[test]
    fn rejects_other_accounts_and_standalone_assets() {
        let mut data = asset_bytes(None, &[]);
        for key in [0u8, 2, 3, 5, 255] {
            data[0] = key;
            assert!(invalid(read_core_asset(&data)), "key {key}");
        }
        let mut data = asset_bytes(None, &[]);
        for tag in [0u8, 1, 3] {
            data[33] = tag;
            assert!(invalid(read_core_asset(&data)), "update authority {tag}");
        }
    }

    #[test]
    fn rejects_truncated_and_malformed_bytes() {
        let full = asset_bytes(
            Some(1),
            &[(PLUGIN_TRANSFER_DELEGATE, PluginAuthority::Address(DELEGATE))],
        );
        let base_len = asset_bytes(Some(1), &[]).len();
        for len in (0..full.len()).filter(|len| *len != base_len) {
            assert!(invalid(read_core_asset(&full[..len])), "length {len}");
        }

        let mut bad_seq = asset_bytes(None, &[]);
        *bad_seq.last_mut().unwrap() = 2;
        assert!(invalid(read_core_asset(&bad_seq)));

        let mut bad_header = full.clone();
        bad_header[base_len] = KEY_PLUGIN_REGISTRY_V1;
        assert!(invalid(read_core_asset(&bad_header)));

        let mut far_registry = full.clone();
        far_registry[base_len + 1..base_len + 9].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(invalid(read_core_asset(&far_registry)));

        let mut bad_authority = full.clone();
        let registry_offset = base_len + 9 + 1;
        bad_authority[registry_offset + 1 + 4 + 1] = 9;
        assert!(invalid(read_core_asset(&bad_authority)));
    }

    #[test]
    fn reads_who_holds_the_freeze_and_whether_it_is_frozen() {
        let plugins = [
            (PLUGIN_FREEZE_DELEGATE, PluginAuthority::Address(DELEGATE)),
            (PLUGIN_TRANSFER_DELEGATE, PluginAuthority::Address(DELEGATE)),
        ];
        let thawed = asset_bytes(None, &plugins);
        let asset = read_core_asset(&thawed).unwrap();
        assert_eq!(
            asset.freeze_delegate,
            Some(FreezeState {
                authority: PluginAuthority::Address(DELEGATE),
                frozen: false
            })
        );
        assert!(asset.freeze_held_by(&DELEGATE));
        assert!(!asset.is_frozen());

        // The frozen flag sits right after the FreezeDelegate tag, the first plugin body.
        let mut frozen = thawed.clone();
        let flag = asset_bytes(None, &[]).len() + 9 + 1;
        frozen[flag] = 1;
        let asset = read_core_asset(&frozen).unwrap();
        assert!(asset.is_frozen());
        assert!(asset.delegates_transfer_to(&DELEGATE));

        frozen[flag] = 2;
        assert!(invalid(read_core_asset(&frozen)), "a bool other than 0 or 1");
        let mut wrong_tag = thawed;
        wrong_tag[flag - 1] = 9;
        assert!(invalid(read_core_asset(&wrong_tag)), "the body must be a FreezeDelegate");

        let none = read_core_asset(&asset_bytes(None, &[])).unwrap();
        assert!(!none.is_frozen() && !none.freeze_held_by(&DELEGATE));
    }

    #[test]
    fn set_frozen_instruction_matches_core() {
        let payer = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let asset = Pubkey::new_unique();
        for frozen in [true, false] {
            let ix = set_frozen_instruction(&asset, &COLLECTION, &payer, &authority, frozen);
            assert_eq!(ix.program_id, MPL_CORE_PROGRAM_ID);
            assert_eq!(ix.data, vec![6, 1, u8::from(frozen)]);
            let shape: Vec<(Pubkey, bool, bool)> = ix
                .accounts
                .iter()
                .map(|meta| (meta.pubkey, meta.is_writable, meta.is_signer))
                .collect();
            assert_eq!(
                shape,
                vec![
                    (asset, true, false),
                    (COLLECTION, true, false),
                    (payer, true, true),
                    (authority, false, true),
                    (anchor_lang::system_program::ID, false, false),
                    (MPL_CORE_PROGRAM_ID, false, false),
                ]
            );
        }
    }

    #[test]
    fn transfer_instruction_matches_core() {
        let payer = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let buyer = Pubkey::new_unique();
        let asset = Pubkey::new_unique();
        let ix = transfer_instruction(&asset, &COLLECTION, &payer, &authority, &buyer);
        assert_eq!(ix.program_id, MPL_CORE_PROGRAM_ID);
        assert_eq!(ix.data, vec![14, 0]);
        let shape: Vec<(Pubkey, bool, bool)> = ix
            .accounts
            .iter()
            .map(|meta| (meta.pubkey, meta.is_writable, meta.is_signer))
            .collect();
        assert_eq!(
            shape,
            vec![
                (asset, true, false),
                (COLLECTION, false, false),
                (payer, true, true),
                (authority, false, true),
                (buyer, false, false),
                (anchor_lang::system_program::ID, false, false),
                (MPL_CORE_PROGRAM_ID, false, false),
            ]
        );
    }
}
