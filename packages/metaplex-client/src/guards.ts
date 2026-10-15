import type { DefaultGuardSetArgs } from '@metaplex-foundation/mpl-core-candy-machine';
import { lamports, none, publicKey, some } from '@metaplex-foundation/umi';

/**
 * Candy Guard settings of the public sale (TECH_STACK §3.3, SPEC §6.1).
 *
 * `thirdPartySigner` makes the backend a required signer of every mint, so a
 * wallet cannot mint without the server building the transaction. `mintLimit`
 * and `solPayment` carry the numbers of the cluster manifest.
 */
export interface SaleGuardSettings {
  /** Price of one citizen, in lamports. */
  readonly priceLamports: bigint;
  /** Where the price goes: `solTreasury`. */
  readonly treasury: string;
  /** Citizens one wallet may mint. */
  readonly mintLimitPerWallet: number;
  /** Identifies the `mintLimit` counter; any stable number works. */
  readonly mintLimitId: number;
  /** The backend key that must co-sign every mint. */
  readonly mintSigner: string;
  /** Unix seconds before which nobody can mint. Left out, minting is open at once. */
  readonly startsAt?: number;
  /** Lamports taken from a failed bot mint (guard `botTax`). Left out, there is no tax. */
  readonly botTaxLamports?: bigint;
}

/** Guard arguments for Umi's `create`, in the shape of its default guard set. */
export function guardSetFor(settings: SaleGuardSettings): Partial<DefaultGuardSetArgs> {
  const { startsAt, botTaxLamports } = settings;
  return {
    botTax:
      botTaxLamports === undefined ? none() : some({ lamports: lamports(botTaxLamports), lastInstruction: true }),
    solPayment: some({ lamports: lamports(settings.priceLamports), destination: publicKey(settings.treasury) }),
    startDate: startsAt === undefined ? none() : some({ date: BigInt(startsAt) }),
    thirdPartySigner: some({ signerKey: publicKey(settings.mintSigner) }),
    mintLimit: some({ id: settings.mintLimitId, limit: settings.mintLimitPerWallet }),
  };
}
