//! The market's hand-written Core reader and `TransferV1` builder, checked
//! against bytes written by Core and against Core's own Rust client.

use market::core_asset::{self, PluginAuthority as MarketAuthority};
use market_integration::*;
use mpl_core::{
    instructions::{AddPluginV1Builder, RemovePluginV1Builder, TransferV1Builder},
    types::{Attribute, Attributes, FreezeDelegate, Plugin, PluginAuthority, PluginType},
    Asset, AuthorityType,
};
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

/// The reader's view and Core's view of the same account must agree.
async fn assert_reader_matches_core(world: &mut World, asset: &Pubkey) {
    let account = world.account(asset).await.expect("asset");
    let ours = core_asset::read_core_asset(&account.data).expect("the reader accepts it");
    let core = Asset::from_bytes(&account.data).expect("Core accepts it");

    assert_eq!(ours.owner, core.base.owner);
    assert_eq!(ours.collection, collection_of(&core));
    let theirs = core.plugin_list.transfer_delegate.map(|plugin| {
        let authority = plugin.base.authority;
        match authority.authority_type {
            AuthorityType::None => MarketAuthority::None,
            AuthorityType::Owner => MarketAuthority::Owner,
            AuthorityType::UpdateAuthority => MarketAuthority::UpdateAuthority,
            AuthorityType::Address => MarketAuthority::Address(authority.address.unwrap()),
        }
    });
    assert_eq!(ours.transfer_delegate, theirs);
}

/// Adds `plugin` signed by `signer`: the owner for owner-managed plugins,
/// the collection's update authority for the rest.
async fn add_plugin(
    world: &mut World,
    asset: &Pubkey,
    signer: &Keypair,
    plugin: Plugin,
    authority: Option<PluginAuthority>,
) {
    let mut builder = AddPluginV1Builder::new();
    builder
        .asset(*asset)
        .collection(Some(world.collection))
        .payer(signer.pubkey())
        .authority(Some(signer.pubkey()))
        .plugin(plugin);
    if let Some(authority) = authority {
        builder.init_authority(authority);
    }
    let instruction = builder.instruction();
    world.send(&[instruction], &[signer]).await.unwrap();
}

#[tokio::test]
async fn reader_agrees_with_core_through_a_plugin_lifecycle() {
    let (mut world, asset) = market_with_citizen().await;
    let seller = world.seller.insecure_clone();
    let admin = world.admin.insecure_clone();
    let authority = world.authority_key();

    // Fresh from the mint: no plugins on the asset itself.
    assert_reader_matches_core(&mut world, &asset).await;
    let account = world.account(&asset).await.unwrap();
    assert_eq!(
        core_asset::read_core_asset(&account.data)
            .unwrap()
            .transfer_delegate,
        None
    );

    // Plugins before and after the delegate, so the registry has several records.
    add_plugin(
        &mut world,
        &asset,
        &admin,
        Plugin::Attributes(Attributes {
            attribute_list: vec![Attribute {
                key: "role".into(),
                value: "Baker".into(),
            }],
        }),
        Some(PluginAuthority::UpdateAuthority),
    )
    .await;
    assert_reader_matches_core(&mut world, &asset).await;

    world.list(&asset, &seller, SOL).await.unwrap();
    assert_reader_matches_core(&mut world, &asset).await;
    let account = world.account(&asset).await.unwrap();
    assert!(core_asset::read_core_asset(&account.data)
        .unwrap()
        .delegates_transfer_to(&authority));

    add_plugin(
        &mut world,
        &asset,
        &seller,
        Plugin::FreezeDelegate(FreezeDelegate { frozen: false }),
        None,
    )
    .await;
    assert_reader_matches_core(&mut world, &asset).await;

    // Revoked, then removed entirely.
    let revoke = world.revoke_delegate_ix(&asset, &seller.pubkey());
    let cancel = world.cancel_ix(&asset, &seller.pubkey());
    world.send(&[revoke, cancel], &[&seller]).await.unwrap();
    assert_reader_matches_core(&mut world, &asset).await;

    let remove = RemovePluginV1Builder::new()
        .asset(asset)
        .collection(Some(world.collection))
        .payer(seller.pubkey())
        .authority(Some(seller.pubkey()))
        .plugin_type(PluginType::TransferDelegate)
        .instruction();
    world.send(&[remove], &[&seller]).await.unwrap();
    assert_reader_matches_core(&mut world, &asset).await;
    let account = world.account(&asset).await.unwrap();
    assert_eq!(
        core_asset::read_core_asset(&account.data)
            .unwrap()
            .transfer_delegate,
        None
    );

    // And after a sale, with the delegate reset by Core.
    let buyer = world.buyer.insecure_clone();
    world.list(&asset, &seller, SOL).await.unwrap();
    world.buy(&asset, &buyer, SOL).await.unwrap();
    assert_reader_matches_core(&mut world, &asset).await;
}

#[test]
fn transfer_instruction_matches_cores_client() {
    let (asset, collection, payer, authority, new_owner) = (
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
    );
    let ours =
        core_asset::transfer_instruction(&asset, &collection, &payer, &authority, &new_owner);
    let theirs = TransferV1Builder::new()
        .asset(asset)
        .collection(Some(collection))
        .payer(payer)
        .authority(Some(authority))
        .new_owner(new_owner)
        .system_program(Some(solana_sdk::system_program::ID))
        .instruction();

    assert_eq!(ours.program_id, theirs.program_id);
    assert_eq!(ours.data, theirs.data);
    assert_eq!(ours.accounts, theirs.accounts);
}
