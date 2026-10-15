import type { MintBackend } from '@bas/metaplex-client';
import { MissionError } from './errors.js';

export interface MintServiceOptions {
  readonly backend: MintBackend;
  /** `mintLimitPerWallet` of the manifest, the same number the Candy Guard enforces. */
  readonly limitPerWallet: number;
  /** Unix seconds when the sale opens; before that nobody gets a transaction. */
  readonly opensAt?: number;
  /** Milliseconds; replaced in tests. */
  readonly clock?: () => number;
}

/** A mint transaction waiting for the wallet's signature. */
export interface MintOffer {
  /** Base64 wire bytes; every signature but the wallet's is in place. */
  readonly transaction: string;
  /** Address the new citizen will have. */
  readonly asset: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
}

/**
 * Hands out the mint transaction of the public sale (D-0061).
 *
 * The Candy Guard names this server's key as `thirdPartySigner`, so a mint
 * cannot reach the Candy Machine without a transaction from here. That makes
 * this the gate for the opening time, and keeps the sale closed while the
 * machine is not fully loaded. The price and the one-per-wallet limit stay
 * with the guard on chain: a wrong answer from this class cannot get around
 * them.
 */
export class MintService {
  private readonly clock: () => number;

  constructor(private readonly options: MintServiceOptions) {
    this.clock = options.clock ?? Date.now;
  }

  async prepare(wallet: string): Promise<MintOffer> {
    const { opensAt, limitPerWallet, backend } = this.options;
    if (opensAt !== undefined && this.clock() / 1000 < opensAt) throw new MissionError('mint-not-open');

    const sale = await backend.sale(wallet);
    if (!sale || sale.itemsLoaded < sale.itemsAvailable) throw new MissionError('unavailable', 'the sale is not set up yet');
    if (sale.itemsRedeemed >= sale.itemsAvailable) throw new MissionError('sold-out');
    if (sale.mintedByWallet >= limitPerWallet) throw new MissionError('mint-limit');

    const prepared = await backend.prepare(wallet);
    return {
      transaction: Buffer.from(prepared.transaction).toString('base64'),
      asset: prepared.asset,
      blockhash: prepared.blockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    };
  }
}
