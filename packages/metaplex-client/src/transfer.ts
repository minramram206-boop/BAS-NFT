import { fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core';
import { publicKey, type TransactionBuilder, type Umi } from '@metaplex-foundation/umi';

export interface TransferAssetInput {
  /** The Core asset to move. */
  readonly asset: string;
  /** The collection the asset belongs to; Core needs it on the instruction for a collection asset. */
  readonly collection: string | null;
  readonly newOwner: string;
}

/**
 * Hands a Core asset to another wallet. The identity of `umi` is the current
 * owner: it signs and pays. This is the same instruction a marketplace or a
 * wallet sends when an NFT is sold, which is what the chat server's owner check
 * has to follow.
 */
export function buildTransferAsset(umi: Umi, input: TransferAssetInput): TransactionBuilder {
  return transferV1(umi, {
    asset: publicKey(input.asset),
    ...(input.collection ? { collection: publicKey(input.collection) } : {}),
    newOwner: publicKey(input.newOwner),
  });
}

export interface AssetOwnership {
  readonly owner: string;
  /** The collection the asset belongs to, or `null` when it has none. */
  readonly collection: string | null;
}

/** Who owns a Core asset and which collection it sits in, as the cluster says right now; `null` when the asset does not exist. */
export async function readAssetOwnership(umi: Umi, asset: string): Promise<AssetOwnership | null> {
  const address = publicKey(asset);
  if (!(await umi.rpc.accountExists(address))) return null;
  const record = await fetchAsset(umi, address);
  return {
    owner: record.owner,
    collection: record.updateAuthority.type === 'Collection' ? (record.updateAuthority.address ?? null) : null,
  };
}
