import { prizeVaultAddress, registerCitizenInstruction } from '@bas/chain-client';
import { address } from '@solana/kit';
import type { Signer, Umi } from '@metaplex-foundation/umi';
import { createMetaplexContext } from './context.js';
import { newSigner, signerFromSecretKey } from './keys.js';
import { buildMintTransaction, type PreparedMint } from './mint.js';
import { readSale, type SaleState } from './sale.js';

/**
 * Compute budget of the mint transaction: Candy Guard checks, the Core asset
 * and its collection plugins, and `register_citizen`. Measured against the real
 * programs (see docs/MISSION_SERVER.md, "Mint"), with room to spare.
 */
export const MINT_COMPUTE_UNIT_LIMIT = 400_000;

export interface MintBackendOptions {
  readonly rpcUrl: string;
  readonly programId: string;
  /** `approvedTemplateId` of the manifest. */
  readonly approvedTemplateId: number;
  readonly candyMachine: string;
  readonly collection: string;
  /** `solTreasury`: where the guard sends the treasury share of the price. */
  readonly treasury: string;
  /** Optional `prizeVaultProgramId` whose vault PDA receives `mintPrizeShareBps` of each mint. */
  readonly prizeVaultProgramId?: string;
  readonly mintPrizeShareBps?: number;
  /** Must equal the id `scripts/devnet/mint-setup.mjs` gave the `mintLimit` guard. */
  readonly mintLimitId: number;
  /** Secret key of the `thirdPartySigner` named in the manifest (`mintSigner`). */
  readonly mintSecretKey: Uint8Array;
  readonly computeUnitLimit?: number;
  /** Replaced in tests. */
  readonly umi?: Umi;
  readonly newAsset?: (umi: Umi) => Signer;
}

/** What the mission server needs from the sale: its state and a mint transaction for a wallet. */
export interface MintBackend {
  /** Public key of the backend signer, to compare with the manifest. */
  readonly signer: string;
  sale(wallet: string): Promise<SaleState | undefined>;
  prepare(wallet: string): Promise<PreparedMint>;
}

export function createMintBackend(options: MintBackendOptions): MintBackend {
  const umi = options.umi ?? createMetaplexContext(options.rpcUrl);
  const mintSigner = signerFromSecretKey(umi, options.mintSecretKey);
  const newAsset = options.newAsset ?? newSigner;
  const sharePrize = Boolean(options.prizeVaultProgramId && (options.mintPrizeShareBps ?? 0) > 0);
  return {
    signer: mintSigner.publicKey,
    sale: (wallet) => readSale(umi, { candyMachine: options.candyMachine, mintLimitId: options.mintLimitId, wallet }),
    async prepare(wallet) {
      const asset = newAsset(umi);
      const [blockhash, register, prizeVault] = await Promise.all([
        umi.rpc.getLatestBlockhash({ commitment: 'confirmed' }),
        registerCitizenInstruction({
          programId: address(options.programId),
          owner: address(wallet),
          asset: address(asset.publicKey),
          approvedTemplateId: options.approvedTemplateId,
        }),
        sharePrize ? prizeVaultAddress(address(options.prizeVaultProgramId as string)) : Promise.resolve(undefined),
      ]);
      return buildMintTransaction(umi, {
        candyMachine: options.candyMachine,
        collection: options.collection,
        minter: wallet,
        asset,
        mintSigner,
        treasury: options.treasury,
        ...(prizeVault ? { prizeVault, mintPrizeShareBps: options.mintPrizeShareBps } : {}),
        mintLimitId: options.mintLimitId,
        register,
        computeUnitLimit: options.computeUnitLimit ?? MINT_COMPUTE_UNIT_LIMIT,
        blockhash,
      });
    },
  };
}
