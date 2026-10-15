import {
  findMintCounterPda,
  findCandyGuardPda,
  safeFetchCandyMachine,
  safeFetchMintCounter,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { publicKey, type Umi } from '@metaplex-foundation/umi';

/** What the sale looks like right now, for one wallet. */
export interface SaleState {
  /** The Core collection every mint joins. */
  readonly collection: string;
  /** Who may mint from the machine: the Candy Guard PDA once the machine is wrapped. */
  readonly mintAuthority: string;
  /** Items the machine was created with. */
  readonly itemsAvailable: number;
  /** Config lines written so far; the machine mints only once this reaches `itemsAvailable`. */
  readonly itemsLoaded: number;
  /** Items handed out so far. */
  readonly itemsRedeemed: number;
  /** Mints this wallet has made under the guard's limit. */
  readonly mintedByWallet: number;
}

/** Reads the Candy Machine and the wallet's `mintLimit` counter. `undefined` when the machine does not exist. */
export async function readSale(
  umi: Umi,
  input: { candyMachine: string; mintLimitId: number; wallet: string },
): Promise<SaleState | undefined> {
  const candyMachine = publicKey(input.candyMachine);
  const machine = await safeFetchCandyMachine(umi, candyMachine);
  if (!machine) return undefined;
  const counter = await safeFetchMintCounter(
    umi,
    findMintCounterPda(umi, {
      id: input.mintLimitId,
      user: publicKey(input.wallet),
      candyMachine,
      candyGuard: publicKey(findCandyGuardPda(umi, { base: candyMachine }), false),
    }),
  );
  return {
    collection: machine.collectionMint,
    mintAuthority: machine.mintAuthority,
    itemsAvailable: Number(machine.data.itemsAvailable),
    itemsLoaded: machine.itemsLoaded,
    itemsRedeemed: Number(machine.itemsRedeemed),
    mintedByWallet: counter?.count ?? 0,
  };
}
