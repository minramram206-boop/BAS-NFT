import {
  acceptOfferInstruction,
  buyInstruction,
  closeExpiredOfferInstruction,
  cancelAuctionInstructions,
  cancelSaleInstructions,
  listForSaleInstructions,
  makeOfferInstruction,
  marketErrorName,
  placeBidInstruction,
  settleAuctionInstruction,
  startAuctionInstructions,
  updatePriceInstruction,
  withdrawOfferInstruction,
  type AuctionDurationHours,
  type OfferDays,
  upgradeScoreInstruction,
  type MarketErrorName,
} from '@bas/chain-client/browser';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type Signature,
} from '@solana/kit';
import type { DistrictTransactions } from './types';

/** The transaction was sent but the cluster rejected it, or it never showed up. */
export class TransactionFailedError extends Error {
  /** Set when the market program refused it, so the screens can say why. */
  readonly marketError: MarketErrorName | undefined;

  constructor(message: string, marketError?: MarketErrorName) {
    super(message);
    this.name = 'TransactionFailedError';
    this.marketError = marketError;
  }
}

/**
 * The Anchor error number in a refused transaction: Anchor logs
 * `Error Number: 6008`, and the runtime reports `custom program error: 0x1778`.
 * RPC clients nest the logs in the error's context and cause, so all of it is searched.
 */
export function anchorErrorNumber(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  const texts: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || seen.has(value)) return;
    if (typeof value === 'string') {
      texts.push(value);
      return;
    }
    if (typeof value !== 'object') return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach((item) => walk(item, depth + 1));
    else {
      if (value instanceof Error) texts.push(value.message);
      for (const key of ['logs', 'context', 'cause', 'data']) walk((value as Record<string, unknown>)[key], depth + 1);
    }
  };
  walk(error, 0);
  for (const text of texts) {
    const logged = /Error Number: (\d+)/.exec(text);
    if (logged) return Number(logged[1]);
  }
  for (const text of texts) {
    const custom = /custom program error: 0x([0-9a-f]+)/i.exec(text);
    if (custom) return Number.parseInt(custom[1] as string, 16);
  }
  return undefined;
}

export interface SignatureStatus {
  /** `null` while the cluster has not seen the transaction. */
  readonly state: 'processed' | 'confirmed' | 'finalized' | null;
  readonly failed: boolean;
}

/** The RPC calls a transaction needs, behind an interface so tests can replace them. */
export interface SendRpc {
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  /** Program that owns the account (used to tell SPL Token from Token-2022), or `null` when it does not exist. */
  ownerOf(account: string): Promise<string | null>;
  send(base64Transaction: string): Promise<string>;
  status(signature: string): Promise<SignatureStatus>;
}

export function kitSendRpc(url: string): SendRpc {
  const rpc = createSolanaRpc(url);
  return {
    async latestBlockhash() {
      return (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
    },
    async ownerOf(account) {
      const { value } = await rpc.getAccountInfo(address(account), { encoding: 'base64' }).send();
      return value ? value.owner : null;
    },
    async send(base64Transaction) {
      return rpc
        .sendTransaction(base64Transaction as never, { encoding: 'base64', preflightCommitment: 'confirmed' })
        .send();
    },
    async status(signature) {
      const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
      const entry = value[0];
      if (!entry) return { state: null, failed: false };
      return { state: entry.confirmationStatus ?? 'processed', failed: entry.err !== null };
    },
  };
}

export interface TransactionsOptions {
  readonly rpc: SendRpc;
  readonly programId: string;
  readonly utilityMint: string;
  /** The market program and the collection it trades; without it every market build throws. */
  readonly market?: { readonly programId: string; readonly collection: string };
  /** Milliseconds between status checks. */
  readonly pollMs?: number;
  /** Milliseconds to wait for a confirmation before giving up. */
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createTransactions(options: TransactionsOptions): DistrictTransactions {
  const { rpc, programId, utilityMint } = options;
  const pollMs = options.pollMs ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const encoder = getTransactionEncoder();
  let tokenProgram: Promise<Address> | undefined;

  const mintProgram = (): Promise<Address> => {
    tokenProgram ??= rpc.ownerOf(utilityMint).then((owner) => {
      if (!owner) throw new TransactionFailedError(`the utility token mint ${utilityMint} does not exist on this cluster`);
      return address(owner);
    });
    return tokenProgram;
  };

  /** An unsigned transaction holding `instructions`, paid by `payer`. */
  const unsigned = async (payer: string, instructions: Promise<Instruction[]>): Promise<Uint8Array> => {
    const [list, { blockhash, lastValidBlockHeight }] = await Promise.all([instructions, rpc.latestBlockhash()]);
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayer(address(payer), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight }, m),
      (m) => appendTransactionMessageInstructions(list, m),
    );
    return new Uint8Array(encoder.encode(compileTransaction(message)));
  };

  const market = (): { programId: Address; collection: Address } => {
    if (!options.market) throw new Error('this cluster has no market program');
    return { programId: address(options.market.programId), collection: address(options.market.collection) };
  };

  return {
    async buildUpgradeScore({ owner, asset, stat }) {
      return unsigned(
        owner,
        mintProgram().then(async (program) => [
          await upgradeScoreInstruction({
            programId: address(programId),
            owner: address(owner),
            asset: address(asset),
            utilityMint: address(utilityMint),
            tokenProgram: program,
            stat,
          }),
        ]),
      );
    },

    async buildListCitizen({ seller, asset, priceLamports, transferDelegate, staleListingSeller }) {
      const { programId: marketId, collection } = market();
      return unsigned(
        seller,
        listForSaleInstructions({
          programId: marketId,
          seller: address(seller),
          asset: address(asset),
          collection,
          priceLamports,
          transferDelegate,
          staleListingSeller: staleListingSeller ? address(staleListingSeller) : null,
        }),
      );
    },

    async buildChangeListingPrice({ seller, asset, priceLamports }) {
      const { programId: marketId } = market();
      return unsigned(
        seller,
        updatePriceInstruction({ programId: marketId, seller: address(seller), asset: address(asset), priceLamports }).then((one) => [one]),
      );
    },

    async buildCancelListing({ seller, asset, transferDelegate }) {
      const { programId: marketId, collection } = market();
      return unsigned(
        seller,
        cancelSaleInstructions({ programId: marketId, seller: address(seller), asset: address(asset), collection, transferDelegate }),
      );
    },

    async buildBuyCitizen({ buyer, asset, seller, maxPriceLamports, config }) {
      const { programId: marketId } = market();
      return unsigned(
        buyer,
        buyInstruction({
          programId: marketId,
          buyer: address(buyer),
          asset: address(asset),
          seller: address(seller),
          config,
          maxPriceLamports,
        }).then((one) => [one]),
      );
    },

    async buildStartAuction({ seller, asset, startPriceLamports, durationHours, staleListingSeller }) {
      const { programId: marketId, collection } = market();
      return unsigned(
        seller,
        startAuctionInstructions({
          programId: marketId,
          seller: address(seller),
          asset: address(asset),
          collection,
          startPriceLamports,
          durationHours: durationHours as AuctionDurationHours,
          staleListingSeller: staleListingSeller ? address(staleListingSeller) : null,
        }),
      );
    },

    async buildPlaceBid({ bidder, asset, amountLamports, previousBidder }) {
      const { programId: marketId } = market();
      return unsigned(
        bidder,
        placeBidInstruction({
          programId: marketId,
          bidder: address(bidder),
          asset: address(asset),
          amountLamports,
          previousBidder: previousBidder ? address(previousBidder) : null,
        }).then((one) => [one]),
      );
    },

    async buildCancelAuction({ seller, asset, transferDelegate, freezeDelegate }) {
      const { programId: marketId, collection } = market();
      return unsigned(
        seller,
        cancelAuctionInstructions({ programId: marketId, seller: address(seller), asset: address(asset), collection, transferDelegate, freezeDelegate }),
      );
    },

    async buildSettleAuction({ caller, auction, config }) {
      const { programId: marketId } = market();
      return unsigned(caller, settleAuctionInstruction({ programId: marketId, caller: address(caller), auction, config }).then((one) => [one]));
    },

    async buildMakeOffer({ buyer, asset, amountLamports, days }) {
      const { programId: marketId } = market();
      return unsigned(
        buyer,
        makeOfferInstruction({ programId: marketId, buyer: address(buyer), asset: address(asset), amountLamports, days: days as OfferDays }).then((one) => [one]),
      );
    },

    async buildWithdrawOffer({ buyer, asset }) {
      const { programId: marketId } = market();
      return unsigned(buyer, withdrawOfferInstruction({ programId: marketId, buyer: address(buyer), asset: address(asset) }).then((one) => [one]));
    },

    async buildAcceptOffer({ owner, buyer, asset, amountLamports, listed, config }) {
      const { programId: marketId } = market();
      return unsigned(
        owner,
        acceptOfferInstruction({
          programId: marketId,
          owner: address(owner),
          buyer: address(buyer),
          asset: address(asset),
          amountLamports,
          listed,
          config,
        }).then((one) => [one]),
      );
    },

    async buildCloseExpiredOffers({ caller, offers }) {
      const { programId: marketId } = market();
      return unsigned(
        caller,
        Promise.all(
          offers.map((offer) =>
            closeExpiredOfferInstruction({ programId: marketId, buyer: address(offer.buyer), asset: address(offer.asset), caller: address(caller) }),
          ),
        ),
      );
    },

    async send(signed) {
      let signature: string;
      try {
        signature = await rpc.send(getBase64Decoder().decode(signed));
      } catch (error) {
        // The cluster checks the transaction before it takes it (preflight), so this is a refusal, not a lost link.
        const code = anchorErrorNumber(error);
        throw new TransactionFailedError(
          error instanceof Error ? error.message : 'the cluster refused the transaction',
          code === undefined ? undefined : marketErrorName(code),
        );
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { state, failed } = await rpc.status(signature);
        if (failed) throw new TransactionFailedError('the cluster rejected the transaction');
        if (state === 'confirmed' || state === 'finalized') return signature;
        await sleep(pollMs);
      }
      throw new TransactionFailedError('the transaction was not confirmed in time');
    },
  };
}
