import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import type { Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';

/** A Umi context for `rpcUrl` with the Core and Core Candy Machine programs registered. */
export function createMetaplexContext(rpcUrl: string): Umi {
  return createUmi(rpcUrl, { commitment: 'confirmed' }).use(mplCore()).use(mplCandyMachine());
}
