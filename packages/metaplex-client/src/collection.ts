import { addCollectionPlugin, fetchCollection } from '@metaplex-foundation/mpl-core';
import { publicKey, type TransactionBuilder, type Umi } from '@metaplex-foundation/umi';

/** SPEC §6.2: the collection carries a Royalties plugin of 5%. */
export const ROYALTY_BASIS_POINTS = 500;

export interface CollectionRoyalties {
  readonly basisPoints: number;
  /** Creators that share the royalty, with their percentage of it. */
  readonly creators: ReadonlyArray<{ readonly address: string; readonly percentage: number }>;
}

/** Adds the Royalties plugin to a collection that has none. The signer must be its update authority. */
export function buildAddRoyalties(
  umi: Umi,
  input: { collection: string; recipient: string; basisPoints?: number },
): TransactionBuilder {
  return addCollectionPlugin(umi, {
    collection: publicKey(input.collection),
    plugin: {
      type: 'Royalties',
      basisPoints: input.basisPoints ?? ROYALTY_BASIS_POINTS,
      creators: [{ address: publicKey(input.recipient), percentage: 100 }],
      ruleSet: { type: 'None' },
    },
  });
}

/** The collection's Royalties plugin, or `undefined` while it has none. */
export async function readRoyalties(umi: Umi, collection: string): Promise<CollectionRoyalties | undefined> {
  const account = await fetchCollection(umi, publicKey(collection));
  if (!account.royalties) return undefined;
  return {
    basisPoints: account.royalties.basisPoints,
    creators: account.royalties.creators.map((creator) => ({ address: creator.address, percentage: creator.percentage })),
  };
}
