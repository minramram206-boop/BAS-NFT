import { createPrivateKey, sign } from 'node:crypto';
import {
  CORE_CANDY_GUARD_PROGRAM_ID,
  CORE_INSTRUCTION,
  INSTRUCTION_DISCRIMINATORS,
  MARKET_ERRORS,
  MARKET_INSTRUCTION_DISCRIMINATORS,
  MARKET_MAX_PRICE_LAMPORTS,
  MARKET_MIN_PRICE_LAMPORTS,
  MPL_CORE_PROGRAM_ID,
  ROLE_TEMPLATES,
  AUCTION_CLOCKS,
  AUCTION_DURATIONS_HOURS,
  marketAuthorityAddress,
  minNextBid,
  type AuctionClock,
  type AuctionOnChain,
  type CitizenStateOnChain,
  type CorePluginAuthority,
  type ListingOnChain,
  type MarketConfigOnChain,
  type MarketErrorName,
} from '@bas/chain-client';
import { address } from '@solana/kit';
import type { CitizenRecord } from '@bas/content';
import type { BidRecord, ChainReader, CitizenOnChain, MarketActivity, SaleRecord } from '@bas/mission-server';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { Balances, ChainCitizen, DistrictReads, MarketReading, SaleReading, WalletSession } from '../src/lib/data/chain/types.ts';
import { WalletDeclinedError } from '../src/lib/data/chain/types.ts';
import type { SendRpc, SignatureStatus } from '../src/lib/data/chain/transactions.ts';

export const PROGRAM_ID = new PublicKey('82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym');
export const UTILITY_MINT = '6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SEASON_START = 1_800_000_000;
export const DAY = 86_400;
export const BASE_COST = 100_000_000n;
export const MARKET_ID = 'EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP';
export const MARKET_AUTHORITY: string = await marketAuthorityAddress(address(MARKET_ID));
export const COLLECTION = '7Cxz7FfrZ5cAeZruPU8wN9fdti4Y97DJgw3y3kXw4jDa';
export const TREASURY = '9DfhjiWco7mDjyiwwSZo9UtyAYqYhjxSw3GyfTmCGEuK';

/** A refusal worded the way Anchor logs it, so the client can tell which rule failed. */
function marketError(name: MarketErrorName): Error {
  return new Error(`Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${6000 + MARKET_ERRORS.indexOf(name)}.`);
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

interface FakeAsset {
  asset: string;
  owner: string;
  serial: number;
  scores: [number, number, number];
  credits: [number, number, number];
  registered: boolean;
  /** The TransferDelegate plugin; Core hands it back to the owner on every transfer. */
  delegate: CorePluginAuthority | null;
  /** The FreezeDelegate plugin, handed back to the owner on transfer like the other. */
  freeze: CorePluginAuthority | null;
  frozen: boolean;
}

/** The public sale in memory: citizens come out in `queue` order, like a draw that happened to be this one. */
export interface FakeSale {
  /** Serials still to be handed out, first one next. */
  queue: number[];
  /** Citizens the machine was created with. */
  total: number;
  /** Lamports one mint costs. */
  price: bigint;
  /** Mints one wallet may make. */
  limit: number;
  minted: Map<string, number>;
  /** Set while the sale is not loaded or the server is not allowed to build mints. */
  loaded: boolean;
}

/**
 * A small cluster in memory. It answers the mission server's reads and the web
 * app's reads, and it applies the transactions the app sends the way the
 * program would: signatures must verify, an upgrade needs a credit and tokens,
 * and a claim receipt can only be created once.
 */
export class World implements ChainReader, DistrictReads {
  readonly assets: FakeAsset[] = [];
  readonly receipts = new Set<string>();
  readonly tokens = new Map<string, bigint>();
  readonly sol = new Map<string, bigint>();
  /** Signatures of transactions that were applied, newest last. */
  readonly applied: string[] = [];
  /** Set to make the next reads fail, like a dropped connection. */
  down = false;
  /** The public sale, or `null` when the cluster has no Candy Machine. */
  sale_: FakeSale | null = null;
  /** Mint transactions the server built, by the asset they create. */
  readonly built: string[] = [];
  /** The market config, or `null` while the market program is not set up. */
  marketConfig: MarketConfigOnChain | null = null;
  /** Listings by their account address. */
  readonly listings = new Map<string, ListingOnChain>();
  /** Auctions by their account address. */
  readonly auctions = new Map<string, AuctionOnChain>();
  /** What the mission server's indexer would have read off the market program, newest first. */
  readonly activity: { sales: SaleRecord[]; bids: BidRecord[] } = { sales: [], bids: [] };

  private readonly roster: readonly CitizenRecord[];
  private readonly nowSeconds: () => number;
  /** The clock the simulated market program was built with. */
  private readonly auctionClock: AuctionClock;

  constructor(roster: readonly CitizenRecord[], nowSeconds: () => number, auctionClock: AuctionClock = AUCTION_CLOCKS.real) {
    this.roster = roster;
    this.nowSeconds = nowSeconds;
    this.auctionClock = auctionClock;
  }

  add(serial: number, owner: string, scores: [number, number, number], credits: [number, number, number] = [0, 0, 0], registered = true): string {
    const asset = Keypair.generate().publicKey.toBase58();
    this.assets.push({ asset, owner, serial, scores, credits, registered, delegate: null, freeze: null, frozen: false });
    return asset;
  }

  find(asset: string): FakeAsset {
    const found = this.assets.find((item) => item.asset === asset);
    if (!found) throw new Error(`no asset ${asset}`);
    return found;
  }

  transfer(asset: string, to: string): void {
    const found = this.find(asset);
    if (found.frozen) throw new Error('Core: the asset is frozen');
    found.owner = to;
    if (found.delegate) found.delegate = { kind: 'owner' };
    if (found.freeze) found.freeze = { kind: 'owner' };
  }

  /** The market's view of what happened, as `GET /market/activity` serves it. */
  marketActivity(): MarketActivity {
    return { sales: [...this.activity.sales], bids: [...this.activity.bids] };
  }

  auctionOf(asset: string): AuctionOnChain | undefined {
    return [...this.auctions.values()].find((auction) => auction.asset === asset);
  }

  /** Sets the market up as `market-setup.mjs` does. */
  openMarket(paused = false): void {
    this.marketConfig = {
      version: 1,
      admin: TREASURY,
      pendingAdmin: '11111111111111111111111111111111',
      collection: COLLECTION,
      royaltyBps: 500,
      royaltyRecipient: TREASURY,
      feeBps: 0,
      feeRecipient: TREASURY,
      isPaused: paused,
      bump: 255,
      authorityBump: 254,
    } as MarketConfigOnChain;
  }

  listingOf(asset: string): ListingOnChain | undefined {
    return [...this.listings.values()].find((listing) => listing.asset === asset);
  }

  // --- the mission server's view -------------------------------------------------

  async assetOwner(asset: string): Promise<string | null> {
    return this.assets.find((item) => item.asset === asset)?.owner ?? null;
  }

  async assetInfo(asset: string): Promise<{ owner: string; serial: number | null } | null> {
    const found = this.assets.find((item) => item.asset === asset);
    return found ? { owner: found.owner, serial: found.serial } : null;
  }

  async citizen(asset: string): Promise<CitizenOnChain | null> {
    const found = this.assets.find((item) => item.asset === asset);
    if (!found || !found.registered) return null;
    const role = ROLE_TEMPLATES.find((template) => template.key === this.roster.find((c) => c.id === found.serial)?.roleKey);
    return {
      citizenId: this.assets.indexOf(found) + 1,
      role: role?.index ?? 0,
      scores: { intelligence: found.scores[0], alignment: found.scores[1], compute: found.scores[2] },
    };
  }

  async claimReceiptExists(asset: string, missionChainId: number, nonce: number): Promise<boolean> {
    return this.receipts.has(`${asset}:${missionChainId}:${nonce}`);
  }

  async latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 };
  }

  // --- the web app's view --------------------------------------------------------

  async citizens(): Promise<readonly ChainCitizen[]> {
    if (this.down) throw new Error('connection dropped');
    return this.assets.map((item): ChainCitizen => {
      const role = ROLE_TEMPLATES.find((template) => template.key === this.roster.find((c) => c.id === item.serial)?.roleKey);
      const state: CitizenStateOnChain | null = item.registered
        ? {
            version: 1,
            bump: 255,
            citizenId: this.assets.indexOf(item) + 1,
            asset: item.asset,
            role: (role?.index ?? 0) as CitizenStateOnChain['role'],
            intelligence: item.scores[0],
            alignment: item.scores[1],
            compute: item.scores[2],
            insightTrainingCredits: item.credits[0],
            bondTrainingCredits: item.credits[1],
            craftTrainingCredits: item.credits[2],
          }
        : null;
      return {
        asset: item.asset,
        owner: item.owner,
        serial: item.serial,
        state,
        transferDelegate: item.delegate,
        freezeDelegate: item.freeze,
        frozen: item.frozen,
      };
    });
  }

  async market(): Promise<MarketReading | null> {
    if (this.down) throw new Error('connection dropped');
    if (!this.marketConfig) return null;
    return {
      config: { ...this.marketConfig },
      authority: MARKET_AUTHORITY,
      listings: [...this.listings.values()].map((item) => ({ ...item })),
      auctions: [...this.auctions.values()].map((item) => ({ ...item })),
    };
  }

  async sale(wallet: string | null): Promise<SaleReading | null> {
    if (this.down) throw new Error('connection dropped');
    const sale = this.sale_;
    if (!sale) return null;
    return {
      itemsAvailable: sale.total,
      itemsRedeemed: sale.total - sale.queue.length,
      mintedByWallet: wallet ? (sale.minted.get(wallet) ?? 0) : 0,
    };
  }

  /** What the mission server needs to build a mint: the sale state, and a transaction a wallet can sign. */
  mintBackend() {
    return {
      signer: 'fake-mint-signer',
      sale: async (wallet: string) => {
        const sale = this.sale_;
        if (!sale) return undefined;
        return {
          collection: 'collection',
          mintAuthority: 'guard',
          itemsAvailable: sale.total,
          itemsLoaded: sale.loaded ? sale.total : 0,
          itemsRedeemed: sale.total - sale.queue.length,
          mintedByWallet: sale.minted.get(wallet) ?? 0,
        };
      },
      prepare: async (wallet: string) => {
        const asset = Keypair.generate();
        const buyer = new PublicKey(wallet);
        const transaction = new Transaction({ feePayer: buyer, recentBlockhash: '11111111111111111111111111111111' });
        transaction.add(
          new TransactionInstruction({
            programId: new PublicKey(CORE_CANDY_GUARD_PROGRAM_ID),
            keys: [
              { pubkey: buyer, isSigner: true, isWritable: true },
              { pubkey: asset.publicKey, isSigner: true, isWritable: true },
            ],
            data: Buffer.alloc(0),
          }),
        );
        // The server's share of the signatures, like the asset keypair and the mint signer in the real transaction.
        transaction.partialSign(asset);
        this.built.push(asset.publicKey.toBase58());
        return {
          transaction: new Uint8Array(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
          asset: asset.publicKey.toBase58(),
          blockhash: '11111111111111111111111111111111',
          lastValidBlockHeight: 1,
        };
      },
    };
  }

  async balances(owner: string): Promise<Balances> {
    if (this.down) throw new Error('connection dropped');
    return { solLamports: this.sol.get(owner) ?? 0n, tokenAtoms: this.tokens.get(owner) ?? 0n };
  }

  // --- transactions --------------------------------------------------------------

  /** Applies a signed transaction like the program would, or throws like a rejected one. */
  apply(bytes: Uint8Array): string {
    const transaction = Transaction.from(bytes);
    if (!transaction.verifySignatures()) throw new Error('a signature is missing or wrong');
    const [instruction] = transaction.instructions;
    if (instruction?.programId.toBase58() === CORE_CANDY_GUARD_PROGRAM_ID) return this.applyMint(transaction, instruction);
    if (transaction.instructions.some((item) => [MARKET_ID, MPL_CORE_PROGRAM_ID].includes(item.programId.toBase58()))) {
      return this.applyMarket(transaction);
    }
    if (transaction.instructions.length !== 1 || !instruction || !instruction.programId.equals(PROGRAM_ID)) {
      throw new Error('not a district transaction');
    }
    const data = new Uint8Array(instruction.data);
    const kind = same(data.subarray(0, 8), INSTRUCTION_DISCRIMINATORS.upgradeScore)
      ? 'upgrade'
      : same(data.subarray(0, 8), INSTRUCTION_DISCRIMINATORS.claimTrainingCredit)
        ? 'claim'
        : null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    if (kind === 'upgrade') {
      const asset = this.find(instruction.keys[1]!.pubkey.toBase58());
      const owner = instruction.keys[3]!;
      if (!owner.isSigner || owner.pubkey.toBase58() !== asset.owner) throw new Error('signer does not hold the asset');
      const stat = data[8]!;
      const cost = BASE_COST * BigInt(asset.scores[stat]! + 1);
      if (asset.credits[stat]! < 1) throw new Error('no credit');
      if ((this.tokens.get(asset.owner) ?? 0n) < cost) throw new Error('not enough tokens');
      this.tokens.set(asset.owner, (this.tokens.get(asset.owner) ?? 0n) - cost);
      asset.credits[stat]! -= 1;
      asset.scores[stat]! += 1;
    } else if (kind === 'claim') {
      const asset = this.find(instruction.keys[1]!.pubkey.toBase58());
      const owner = instruction.keys[4]!;
      if (!owner.isSigner || owner.pubkey.toBase58() !== asset.owner) throw new Error('signer does not hold the asset');
      const stat = data[8]!;
      const missionId = view.getBigUint64(9, true);
      const nonce = view.getBigUint64(21, true);
      const expiresAt = view.getBigInt64(29, true);
      if (BigInt(this.nowSeconds()) >= expiresAt) throw new Error('claim expired');
      const key = `${asset.asset}:${missionId}:${nonce}`;
      if (this.receipts.has(key)) throw new Error('receipt already exists');
      this.receipts.add(key);
      asset.credits[stat]! += 1;
    } else {
      throw new Error('unknown instruction');
    }
    const signature = transaction.signatures[0]!.signature!.toString('base64');
    this.applied.push(signature);
    return signature;
  }

  /** The Candy Guard mint plus `register_citizen`, as one step: the buyer pays, the next citizen of the draw is theirs. */
  private applyMint(transaction: Transaction, instruction: TransactionInstruction): string {
    const sale = this.sale_;
    if (!sale || !sale.loaded) throw new Error('no sale');
    const buyer = instruction.keys[0]!.pubkey.toBase58();
    const asset = instruction.keys[1]!.pubkey.toBase58();
    const serial = sale.queue[0];
    if (serial === undefined) throw new Error('sold out');
    if ((sale.minted.get(buyer) ?? 0) >= sale.limit) throw new Error('mint limit reached');
    const balance = this.sol.get(buyer) ?? 0n;
    if (balance < sale.price) throw new Error('not enough SOL');
    this.sol.set(buyer, balance - sale.price);
    sale.queue.shift();
    sale.minted.set(buyer, (sale.minted.get(buyer) ?? 0) + 1);
    const base = this.roster.find((citizen) => citizen.id === serial);
    const scores: [number, number, number] = [base?.intelligence ?? 0, base?.alignment ?? 0, base?.compute ?? 0];
    this.assets.push({ asset, owner: buyer, serial, scores, credits: [0, 0, 0], registered: true, delegate: null, freeze: null, frozen: false });
    const signature = transaction.signatures[0]!.signature!.toString('base64');
    this.applied.push(signature);
    return signature;
  }

  /**
   * Core plugin instructions and market instructions, all or nothing, with
   * the checks the programs make. Refusals carry the Anchor error number.
   */
  private applyMarket(transaction: Transaction): string {
    const saved = {
      assets: this.assets.map((item) => ({ ...item })),
      listings: new Map(this.listings),
      auctions: new Map(this.auctions),
      sol: new Map(this.sol),
      sales: [...this.activity.sales],
      bids: [...this.activity.bids],
    };
    const signature = transaction.signatures[0]!.signature!.toString('base64');
    try {
      for (const instruction of transaction.instructions) {
        const program = instruction.programId.toBase58();
        if (program === MPL_CORE_PROGRAM_ID) this.applyCorePlugin(instruction);
        else if (program === MARKET_ID) this.applyMarketInstruction(instruction, signature);
        else throw new Error(`unexpected program ${program}`);
      }
    } catch (error) {
      // Each object is replaced, never changed in place, so the copies above are the state before.
      this.assets.splice(0, this.assets.length, ...saved.assets);
      const restore = <K, V>(map: Map<K, V>, from: Map<K, V>) => {
        map.clear();
        for (const [key, value] of from) map.set(key, value);
      };
      restore(this.listings, saved.listings);
      restore(this.auctions, saved.auctions);
      restore(this.sol, saved.sol);
      this.activity.sales = saved.sales;
      this.activity.bids = saved.bids;
      throw error;
    }
    this.applied.push(signature);
    return signature;
  }

  /**
   * The owner's Core plugin instructions on the TransferDelegate (type 3) and
   * the FreezeDelegate (type 1), with Core's rules: a plugin delegated to
   * someone must be revoked before it is approved again, and a frozen asset
   * keeps its FreezeDelegate.
   */
  private applyCorePlugin(instruction: TransactionInstruction): void {
    const data = new Uint8Array(instruction.data);
    const index = this.assets.findIndex((item) => item.asset === instruction.keys[0]!.pubkey.toBase58());
    const asset = { ...this.assets[index]! };
    const authority = instruction.keys[3]!;
    if (!authority.isSigner || authority.pubkey.toBase58() !== asset.owner) throw new Error('Core: the owner must sign');
    const slot = data[1] === 3 ? 'delegate' : data[1] === 1 ? 'freeze' : null;
    if (!slot) throw new Error(`Core: unexpected plugin ${data[1]}`);
    const delegateAt = (offset: number): CorePluginAuthority => ({
      kind: 'address',
      address: address(new PublicKey(data.subarray(offset, offset + 32)).toBase58()),
    });
    if (data[0] === CORE_INSTRUCTION.addPluginV1) {
      if (asset[slot]) throw new Error('Core: plugin already exists');
      // A FreezeDelegate body carries its `frozen` flag before the authority.
      const at = slot === 'freeze' ? 3 : 2;
      if (slot === 'freeze') asset.frozen = data[2] === 1;
      if (data[at] !== 1 || data[at + 1] !== 3) throw new Error('Core: expected an address authority');
      asset[slot] = delegateAt(at + 2);
    } else if (data[0] === CORE_INSTRUCTION.approvePluginAuthorityV1) {
      if (!asset[slot]) throw new Error('Core: plugin not found');
      if (asset[slot]?.kind === 'address') throw new Error('Core: CannotRedelegate');
      asset[slot] = delegateAt(3);
    } else if (data[0] === CORE_INSTRUCTION.revokePluginAuthorityV1) {
      if (!asset[slot] || asset[slot]?.kind === 'owner') throw new Error('Core: nothing to revoke');
      if (slot === 'freeze' && asset.frozen) throw new Error('Core: the asset is frozen');
      asset[slot] = { kind: 'owner' };
    } else {
      throw new Error(`Core: unexpected instruction ${data[0]}`);
    }
    this.assets[index] = asset;
  }

  private applyMarketInstruction(instruction: TransactionInstruction, signature: string): void {
    const data = new Uint8Array(instruction.data);
    const kind = (Object.keys(MARKET_INSTRUCTION_DISCRIMINATORS) as (keyof typeof MARKET_INSTRUCTION_DISCRIMINATORS)[]).find((name) =>
      same(data.subarray(0, 8), MARKET_INSTRUCTION_DISCRIMINATORS[name]),
    );
    const config = this.marketConfig;
    if (!config) throw new Error('AccountNotInitialized: market config');
    const key = (index: number) => instruction.keys[index]!;
    const u64 = (): bigint => new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(8, true);
    const delegated = (asset: FakeAsset) => asset.delegate?.kind === 'address' && asset.delegate.address === MARKET_AUTHORITY;
    const freezeHeld = (asset: FakeAsset) => asset.freeze?.kind === 'address' && asset.freeze.address === MARKET_AUTHORITY;
    const credit = (to: string, lamports: bigint) => this.sol.set(to, (this.sol.get(to) ?? 0n) + lamports);
    /** Replaces the asset object, so a rolled-back transaction keeps the one from before. */
    const change = (asset: FakeAsset, next: Partial<FakeAsset>): FakeAsset => {
      const updated = { ...asset, ...next };
      this.assets[this.assets.indexOf(asset)] = updated;
      return updated;
    };
    const auctionAt = (index: number): AuctionOnChain => {
      const auction = this.auctions.get(key(index).pubkey.toBase58());
      if (!auction) throw new Error('AccountNotInitialized: auction');
      return auction;
    };
    const canDeliver = (auction: AuctionOnChain, asset: FakeAsset) =>
      asset.owner === auction.seller && asset.frozen && freezeHeld(asset) && delegated(asset);
    const now = this.nowSeconds();
    const stale = (listing: ListingOnChain) => {
      const asset = this.find(listing.asset);
      return asset.owner !== listing.seller || !delegated(asset);
    };
    const signer = (index: number): string => {
      if (!key(index).isSigner) throw new Error('missing signature');
      return key(index).pubkey.toBase58();
    };
    const listingAt = (index: number): ListingOnChain => {
      const listing = this.listings.get(key(index).pubkey.toBase58());
      if (!listing) throw new Error('AccountNotInitialized: listing');
      return listing;
    };
    const inRange = (price: bigint) => {
      if (price < MARKET_MIN_PRICE_LAMPORTS || price > MARKET_MAX_PRICE_LAMPORTS) throw marketError('PriceOutOfRange');
    };

    switch (kind) {
      case 'createListing': {
        if (config.isPaused) throw marketError('MarketPaused');
        const seller = signer(3);
        const asset = this.find(key(2).pubkey.toBase58());
        if (asset.owner !== seller) throw marketError('NotOwner');
        if (!delegated(asset)) throw marketError('DelegateMissing');
        inRange(u64());
        const at = key(1).pubkey.toBase58();
        if (this.listings.has(at)) throw new Error('Allocate: account already in use');
        this.listings.set(at, { version: 1, asset: asset.asset, seller, priceLamports: u64(), listedAt: this.nowSeconds(), bump: 255 } as ListingOnChain);
        return;
      }
      case 'updatePrice': {
        if (config.isPaused) throw marketError('MarketPaused');
        const listing = listingAt(1);
        if (listing.seller !== signer(3)) throw marketError('Unauthorized');
        if (stale(listing)) throw marketError('ListingStale');
        inRange(u64());
        if (u64() === listing.priceLamports) throw marketError('PriceUnchanged');
        this.listings.set(key(1).pubkey.toBase58(), { ...listing, priceLamports: u64() });
        return;
      }
      case 'cancelListing': {
        const listing = listingAt(0);
        if (listing.seller !== signer(1)) throw marketError('Unauthorized');
        this.listings.delete(key(0).pubkey.toBase58());
        return;
      }
      case 'closeStaleListing': {
        signer(4);
        const listing = listingAt(1);
        if (listing.seller !== key(3).pubkey.toBase58()) throw marketError('Unauthorized');
        if (!stale(listing)) throw marketError('ListingNotStale');
        this.listings.delete(key(1).pubkey.toBase58());
        return;
      }
      case 'buy': {
        if (config.isPaused) throw marketError('MarketPaused');
        const listing = listingAt(1);
        const asset = this.find(key(2).pubkey.toBase58());
        const buyer = signer(5);
        if (listing.asset !== asset.asset || key(4).pubkey.toBase58() !== listing.seller) throw marketError('Unauthorized');
        if (key(6).pubkey.toBase58() !== config.royaltyRecipient) throw marketError('InvalidConfig');
        if (stale(listing)) throw marketError('ListingStale');
        if (buyer === listing.seller) throw marketError('BuyerIsSeller');
        if (listing.priceLamports > u64()) throw marketError('PriceAboveLimit');
        if (asset.frozen) throw marketError('AssetFrozen');
        const price = listing.priceLamports;
        const royalty = (price * BigInt(config.royaltyBps)) / 10_000n;
        if ((this.sol.get(buyer) ?? 0n) < price) throw new Error('insufficient lamports');
        this.sol.set(buyer, (this.sol.get(buyer) ?? 0n) - price);
        this.sol.set(listing.seller, (this.sol.get(listing.seller) ?? 0n) + price - royalty);
        this.sol.set(config.royaltyRecipient, (this.sol.get(config.royaltyRecipient) ?? 0n) + royalty);
        change(asset, { owner: buyer, delegate: { kind: 'owner' }, freeze: asset.freeze ? { kind: 'owner' } : null });
        this.listings.delete(key(1).pubkey.toBase58());
        this.activity.sales.unshift({
          signature,
          asset: asset.asset,
          seller: listing.seller,
          buyer,
          priceLamports: price.toString(),
          sellerLamports: (price - royalty).toString(),
          kind: 'fixed',
          at: now,
        });
        return;
      }
      case 'createAuction': {
        if (config.isPaused) throw marketError('MarketPaused');
        const seller = signer(5);
        const price = u64();
        inRange(price);
        if (!AUCTION_DURATIONS_HOURS.includes(data[16] as (typeof AUCTION_DURATIONS_HOURS)[number])) throw marketError('InvalidDuration');
        if (this.listings.has(key(2).pubkey.toBase58())) throw marketError('ListingExists');
        const asset = this.find(key(3).pubkey.toBase58());
        if (asset.owner !== seller) throw marketError('NotOwner');
        if (!delegated(asset)) throw marketError('DelegateMissing');
        if (asset.frozen) throw marketError('AssetFrozen');
        if (!freezeHeld(asset)) throw marketError('FreezeMissing');
        const at = key(1).pubkey.toBase58();
        if (this.auctions.has(at)) throw new Error('Allocate: account already in use');
        change(asset, { frozen: true });
        this.auctions.set(at, {
          version: 1,
          asset: asset.asset,
          seller,
          startPriceLamports: price,
          highestBidLamports: 0n,
          highestBidder: null,
          startedAt: now,
          endsAt: now + data[16]! * this.auctionClock.hourSeconds,
          bidCount: 0,
          bump: 255,
        } as AuctionOnChain);
        return;
      }
      case 'placeBid': {
        if (config.isPaused) throw marketError('MarketPaused');
        const auction = auctionAt(1);
        const asset = this.find(key(2).pubkey.toBase58());
        const bidder = signer(3);
        const amount = u64();
        if (now >= auction.endsAt) throw marketError('AuctionEnded');
        if (!canDeliver(auction, asset)) throw marketError('AuctionUndeliverable');
        if (bidder === auction.seller) throw marketError('BuyerIsSeller');
        const hasBids = auction.bidCount > 0;
        if (hasBids && bidder === auction.highestBidder) throw marketError('AlreadyHighestBidder');
        if (amount < minNextBid(auction.startPriceLamports, hasBids ? auction.highestBidLamports : null)) throw marketError('BidTooLow');
        if (amount > MARKET_MAX_PRICE_LAMPORTS) throw marketError('PriceOutOfRange');
        const previous = key(4).pubkey.toBase58();
        if (hasBids && previous !== auction.highestBidder) throw marketError('WrongBidder');
        if ((this.sol.get(bidder) ?? 0n) < amount) throw new Error('insufficient lamports');
        this.sol.set(bidder, (this.sol.get(bidder) ?? 0n) - amount);
        if (hasBids && auction.highestBidder) credit(auction.highestBidder, auction.highestBidLamports);
        this.auctions.set(key(1).pubkey.toBase58(), {
          ...auction,
          highestBidLamports: amount,
          highestBidder: bidder as AuctionOnChain['highestBidder'],
          bidCount: auction.bidCount + 1,
          endsAt: Math.max(auction.endsAt, now + this.auctionClock.extensionSeconds),
        });
        this.activity.bids.unshift({
          signature,
          asset: asset.asset,
          bidder,
          amountLamports: amount.toString(),
          previousBidder: hasBids ? auction.highestBidder : null,
          at: now,
        });
        return;
      }
      case 'cancelAuction': {
        const auction = auctionAt(1);
        const asset = this.find(key(2).pubkey.toBase58());
        if (signer(4) !== auction.seller) throw marketError('Unauthorized');
        if (auction.bidCount > 0) throw marketError('AuctionHasBids');
        if (asset.frozen && freezeHeld(asset)) change(asset, { frozen: false });
        this.auctions.delete(key(1).pubkey.toBase58());
        return;
      }
      case 'settleAuction': {
        signer(10);
        const auction = auctionAt(1);
        let asset = this.find(key(2).pubkey.toBase58());
        const hasBids = auction.bidCount > 0;
        const deliverable = canDeliver(auction, asset);
        if (!(now >= auction.endsAt || (hasBids && !deliverable))) throw marketError('AuctionNotEnded');
        const winner = key(5).pubkey.toBase58();
        if (hasBids && winner !== auction.highestBidder) throw marketError('WrongBidder');
        if (asset.frozen && freezeHeld(asset)) asset = change(asset, { frozen: false });
        const price = auction.highestBidLamports;
        if (hasBids && deliverable) {
          const royalty = (price * BigInt(config.royaltyBps)) / 10_000n;
          change(asset, { owner: winner, delegate: { kind: 'owner' }, freeze: { kind: 'owner' } });
          credit(auction.seller, price - royalty);
          credit(config.royaltyRecipient, royalty);
          this.activity.sales.unshift({
            signature,
            asset: asset.asset,
            seller: auction.seller,
            buyer: winner,
            priceLamports: price.toString(),
            sellerLamports: (price - royalty).toString(),
            kind: 'auction',
            at: now,
          });
        } else if (hasBids) {
          credit(winner, price);
        }
        this.auctions.delete(key(1).pubkey.toBase58());
        return;
      }
      default:
        throw new Error('unknown market instruction');
    }
  }

  /** A `SendRpc` that lands transactions in this world. */
  sendRpc(): SendRpc & { sent: number; status: SendRpc['status'] } {
    const landed = new Set<string>();
    const rpc = {
      sent: 0,
      latestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1n }),
      ownerOf: async (account: string) => (account === UTILITY_MINT ? TOKEN_PROGRAM : null),
      send: async (base64: string) => {
        rpc.sent += 1;
        const signature = this.apply(Buffer.from(base64, 'base64'));
        landed.add(signature);
        return signature;
      },
      status: async (signature: string): Promise<SignatureStatus> => ({
        state: landed.has(signature) ? 'confirmed' : null,
        failed: false,
      }),
    };
    return rpc;
  }
}

/** Signs `message` as `keypair` the way a wallet's `signMessage` does. */
function signMessage(keypair: Keypair, message: Uint8Array): Uint8Array {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(message), key);
}

export interface TestWallet extends WalletSession {
  readonly keypair: Keypair;
  /** Number of prompts the person has seen, by kind. */
  readonly prompts: { message: number; transaction: number };
  /** While true, the person closes every prompt. */
  decline: boolean;
  /** While true, only the message prompt is closed (the sign-in). */
  declineMessages: boolean;
}

export function testWallet(keypair = Keypair.generate()): TestWallet {
  const wallet: TestWallet = {
    keypair,
    address: keypair.publicKey.toBase58(),
    prompts: { message: 0, transaction: 0 },
    decline: false,
    declineMessages: false,
    async signMessage(message) {
      wallet.prompts.message += 1;
      if (wallet.decline || wallet.declineMessages) throw new WalletDeclinedError();
      return signMessage(keypair, message);
    },
    async signTransaction(bytes) {
      wallet.prompts.transaction += 1;
      if (wallet.decline) throw new WalletDeclinedError();
      const transaction = Transaction.from(bytes);
      transaction.partialSign(keypair);
      return new Uint8Array(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
    },
  };
  return wallet;
}
