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
  /** Where the treasury share of the price goes: `solTreasury`. */
  readonly treasury: string;
  /** Prize vault PDA that receives `prizeShareBps` of the mint price via `solFixedFee`. */
  readonly prizeVault?: string;
  /** Share of `priceLamports` sent to `prizeVault`, in basis points (`0` to `10000`). */
  readonly prizeShareBps?: number;
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

/** Splits the mint price between `solTreasury` and `PrizePoolVault` by basis points. */
export function splitMintPayment(
  priceLamports: bigint,
  prizeShareBps = 0,
): { treasuryLamports: bigint; prizeVaultLamports: bigint } {
  if (!Number.isInteger(prizeShareBps) || prizeShareBps < 0 || prizeShareBps > 10_000) {
    throw new RangeError('prizeShareBps must be an integer between 0 and 10000');
  }
  const prizeVaultLamports = (priceLamports * BigInt(prizeShareBps)) / 10_000n;
  return { treasuryLamports: priceLamports - prizeVaultLamports, prizeVaultLamports };
}

/** Guard arguments for Umi's `create`, in the shape of its default guard set. */
export function guardSetFor(settings: SaleGuardSettings): Partial<DefaultGuardSetArgs> {
  const { startsAt, botTaxLamports, prizeVault, prizeShareBps = 0 } = settings;
  const { treasuryLamports, prizeVaultLamports } = splitMintPayment(settings.priceLamports, prizeVault ? prizeShareBps : 0);
  return {
    botTax:
      botTaxLamports === undefined ? none() : some({ lamports: lamports(botTaxLamports), lastInstruction: true }),
    solPayment:
      treasuryLamports > 0n
        ? some({ lamports: lamports(treasuryLamports), destination: publicKey(settings.treasury) })
        : none(),
    ...(prizeVault && prizeVaultLamports > 0n
      ? { solFixedFee: some({ lamports: lamports(prizeVaultLamports), destination: publicKey(prizeVault) }) }
      : {}),
    startDate: startsAt === undefined ? none() : some({ date: BigInt(startsAt) }),
    thirdPartySigner: some({ signerKey: publicKey(settings.mintSigner) }),
    mintLimit: some({ id: settings.mintLimitId, limit: settings.mintLimitPerWallet }),
  };
}
