import { findCandyGuardPda } from '@metaplex-foundation/mpl-core-candy-machine';
import { createSignerFromKeypair, generateSigner, publicKey, signerIdentity, type KeypairSigner, type Signer, type Umi } from '@metaplex-foundation/umi';

/** A signer from a `solana-keygen` secret key: 32 bytes of seed followed by the 32 bytes of the public key. */
export function signerFromSecretKey(umi: Umi, secretKey: Uint8Array): Signer {
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secretKey));
}

/** A fresh random signer, for a new asset or a new Candy Machine address. */
export function newSigner(umi: Umi): KeypairSigner {
  return generateSigner(umi);
}

/** Makes `signer` the payer and default authority of the transactions `umi` builds. */
export function useSigner(umi: Umi, signer: Signer): Umi {
  return umi.use(signerIdentity(signer));
}

/** Address of the Candy Guard that wraps `candyMachine`. */
export function candyGuardOf(umi: Umi, candyMachine: string): string {
  return findCandyGuardPda(umi, { base: publicKey(candyMachine) })[0];
}
