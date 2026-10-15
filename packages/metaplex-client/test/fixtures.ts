import { lamports, publicKey, type KeypairSigner, type Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi';

/** A Umi context that never touches the network: rent is a constant. */
export function offlineUmi(): Umi {
  const umi = createUmi('http://127.0.0.1:9', { commitment: 'confirmed' }).use(mplCore()).use(mplCandyMachine());
  umi.rpc = { ...umi.rpc, getRent: async () => lamports(5_000_000n) };
  // The deployer: payer and candy machine authority of the setup transactions.
  return umi.use(signerIdentity(signerOf(umi, 'deployer')));
}

/** A signer that is the same on every run, derived from `label`. */
export function signerOf(umi: Umi, label: string): KeypairSigner {
  const seed = new Uint8Array(32);
  seed.set(new TextEncoder().encode(label).subarray(0, 32));
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSeed(seed));
}

export const PROGRAM_ID = '82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym';
export const TREASURY = publicKey('BASTreasuryDevnet11111111111111111111111111');
export const BLOCKHASH = { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1_000 };
