import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { findCandyGuardPda, mintV1 } from '@metaplex-foundation/mpl-core-candy-machine';
import {
  createNoopSigner,
  publicKey,
  some,
  transactionBuilder,
  type BlockhashWithExpiryBlockHeight,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi';
import type { Instruction } from '@solana/kit';
import { toUmiInstruction } from './convert.js';

export interface MintTransactionInput {
  readonly candyMachine: string;
  readonly collection: string;
  /** Wallet that pays, signs last and becomes the owner of the citizen. */
  readonly minter: string;
  /** Fresh keypair that becomes the address of the new asset. */
  readonly asset: Signer;
  /** The backend key named by the guard's `thirdPartySigner`. */
  readonly mintSigner: Signer;
  /** `solTreasury`, where the guard sends the price. */
  readonly treasury: string;
  /** Must equal the `mintLimit.id` the guard was created with. */
  readonly mintLimitId: number;
  /** `register_citizen` for `asset`, from `@bas/chain-client`. */
  readonly register: Instruction;
  readonly computeUnitLimit: number;
  readonly blockhash: BlockhashWithExpiryBlockHeight;
}

export interface PreparedMint {
  /** Wire bytes of the transaction: every signature but the minter's is in place. */
  readonly transaction: Uint8Array;
  readonly asset: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
}

const BLANK_SIGNATURE = new Uint8Array(64);

/**
 * One transaction that mints a citizen and registers it (SPEC §6.3):
 *
 *   compute budget → Candy Guard mint (payment, limit, backend signer) → `register_citizen`
 *
 * The asset keypair and the backend key sign here; the minter's slot is left
 * blank for the wallet. Because the registration is in the same transaction,
 * a failed registration rolls the mint back and no official asset is left
 * without a citizen record.
 */
export async function buildMintTransaction(umi: Umi, input: MintTransactionInput): Promise<PreparedMint> {
  if (input.minter === input.asset.publicKey || input.minter === input.mintSigner.publicKey) {
    throw new Error('the minter must be a different key from the new asset and the backend signer');
  }
  const minter = createNoopSigner(publicKey(input.minter));
  const candyMachine = publicKey(input.candyMachine);
  const candyGuard = findCandyGuardPda(umi, { base: candyMachine });

  const builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: input.computeUnitLimit }))
    .add(
      mintV1(umi, {
        candyMachine,
        candyGuard,
        asset: input.asset,
        collection: publicKey(input.collection),
        minter,
        payer: minter,
        mintArgs: {
          solPayment: some({ destination: publicKey(input.treasury) }),
          mintLimit: some({ id: input.mintLimitId }),
          thirdPartySigner: some({ signer: input.mintSigner }),
        },
      }),
    )
    .add({ instruction: toUmiInstruction(input.register), signers: [minter], bytesCreatedOnChain: 0 })
    .setFeePayer(minter)
    .setBlockhash(input.blockhash);

  const signed = await builder.buildAndSign(umi);
  const message = umi.transactions.deserialize(umi.transactions.serialize(signed)).message;
  const required = message.accounts.slice(0, message.header.numRequiredSignatures);
  const blank = required.filter((_, index) => signed.signatures[index]?.every((byte, at) => byte === BLANK_SIGNATURE[at]));
  if (blank.length !== 1 || blank[0] !== minter.publicKey) {
    throw new Error('the mint transaction must leave exactly the minter unsigned');
  }
  return {
    transaction: umi.transactions.serialize(signed),
    asset: input.asset.publicKey,
    blockhash: input.blockhash.blockhash,
    lastValidBlockHeight: input.blockhash.lastValidBlockHeight,
  };
}
