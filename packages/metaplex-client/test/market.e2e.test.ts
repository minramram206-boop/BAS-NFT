import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import {
  AUCTION_CLOCKS,
  MARKET_ERRORS,
  MPL_CORE_PROGRAM_ID,
  buyInstruction,
  cancelSaleInstructions,
  decodeCollectionRoyalties,
  decodeCoreAssetForMarket,
  decodeListing,
  decodeMarketConfig,
  initializeMarketConfigInstruction,
  listForSaleInstructions,
  listingAddress,
  pointPluginInstructions,
  marketAuthorityAddress,
  marketConfigAddress,
  programDataAddress,
  setMarketPausedInstruction,
  updatePriceInstruction,
  cancelAuctionInstructions,
  decodeAuction,
  marketEventsFromLogs,
  placeBidInstruction,
  settleAuctionInstruction,
  startAuctionInstructions,
  auctionAddress,
  acceptOfferInstruction,
  closeExpiredOfferInstruction,
  decodeOffer,
  makeOfferInstruction,
  offerAddress,
  withdrawOfferInstruction,
  type CoreAssetMarketView,
} from '@bas/chain-client';
import {
  addPluginV1,
  createCollectionV1,
  createV1,
  mplCore,
  transferV1,
} from '@metaplex-foundation/mpl-core';
import { createNoopSigner, none, publicKey, type Instruction as UmiInstruction, type Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';

/**
 * The market's client against the programs themselves: the market binary
 * built with `cargo build-sbf` and the Core binary dumped from devnet, run in
 * LiteSVM. Every transaction here is assembled from the same `@bas/chain-client`
 * functions the web app and the setup script use.
 *
 * Needs `target/deploy/market.so`, `programs/market/integration/tests/fixtures/mpl_core.so`
 * and a LiteSVM build for this platform (Linux or macOS; there is none for
 * Windows, so run it in WSL). Without them the suite is skipped.
 */

const root = findRepoRoot();
const MARKET_SO = join(root, 'target/deploy/market.so');
const CORE_SO = join(root, 'programs/market/integration/tests/fixtures/mpl_core.so');
const MARKET = address('EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP');
const CORE = address(MPL_CORE_PROGRAM_ID);
const SOL = 1_000_000_000n;

type LiteSvmModule = typeof import('litesvm');
let litesvm: LiteSvmModule | undefined;
let skip: string | false = false;
if (!existsSync(MARKET_SO)) skip = `${MARKET_SO} is missing; build it with cargo build-sbf`;
else if (!existsSync(CORE_SO)) skip = `${CORE_SO} is missing; dump it from devnet`;
else {
  try {
    litesvm = await import('litesvm');
  } catch {
    skip = `LiteSVM has no build for ${process.platform}-${process.arch}; run this suite in WSL`;
  }
}
/** The clock the binary was built with: the `devnet-clock` build carries this text in its logs. */
const clock = existsSync(MARKET_SO) && readFileSync(MARKET_SO).includes('BAS devnet auction clock') ? AUCTION_CLOCKS['devnet-fast'] : AUCTION_CLOCKS.real;

const roleOf = (key: UmiInstruction['keys'][number]): AccountRole =>
  key.isSigner
    ? key.isWritable
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.READONLY_SIGNER
    : key.isWritable
      ? AccountRole.WRITABLE
      : AccountRole.READONLY;

const fromUmi = (instruction: UmiInstruction): Instruction => ({
  programAddress: address(instruction.programId),
  accounts: instruction.keys.map((key) => ({ address: address(key.pubkey), role: roleOf(key) })),
  data: Uint8Array.from(instruction.data),
});

class World {
  readonly svm: InstanceType<LiteSvmModule['LiteSVM']>;
  readonly umi: Umi;
  readonly admin: KeyPairSigner;
  readonly treasury: KeyPairSigner;
  readonly seller: KeyPairSigner;
  readonly buyer: KeyPairSigner;

  constructor(admin: KeyPairSigner, treasury: KeyPairSigner, seller: KeyPairSigner, buyer: KeyPairSigner) {
    this.admin = admin;
    this.treasury = treasury;
    this.seller = seller;
    this.buyer = buyer;
    const { LiteSVM } = litesvm as LiteSvmModule;
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(CORE, CORE_SO);
    this.svm.addProgramFromFile(MARKET, MARKET_SO);
    for (const signer of [admin, treasury, seller, buyer]) this.svm.airdrop(signer.address, lamports(100n * SOL));
    this.umi = createUmi('http://127.0.0.1:9').use(mplCore());
  }

  /** Signs with `signers` (the first pays) and runs the transaction; returns the logs, or throws them. */
  async send(instructions: Instruction[], signers: KeyPairSigner[]): Promise<string[]> {
    const result = await this.attempt(instructions, signers);
    if (!result.ok) throw new Error(`transaction failed: ${result.error}\n${result.logs.join('\n')}`);
    return result.logs;
  }

  async attempt(instructions: Instruction[], signers: KeyPairSigner[]) {
    const { FailedTransactionMetadata } = litesvm as LiteSvmModule;
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer((signers[0] as KeyPairSigner).address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n }, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransaction(
      signers.map((signer) => signer.keyPair),
      compileTransaction(message),
    );
    const result = this.svm.sendTransaction(signed);
    // A new blockhash, so sending the same instructions twice is not a duplicate.
    this.svm.expireBlockhash();
    if (result instanceof FailedTransactionMetadata) {
      return { ok: false as const, error: result.toString(), logs: result.meta().logs() };
    }
    return { ok: true as const, logs: result.logs() };
  }

  /** The bank's clock, in Unix seconds. */
  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }

  /** Moves the bank's clock, as time passing would. */
  setTime(unixTimestamp: bigint): void {
    const { Clock } = litesvm as LiteSvmModule;
    const clock = this.svm.getClock();
    this.svm.setClock(new Clock(clock.slot, clock.epochStartTimestamp, clock.epoch, clock.leaderScheduleEpoch, unixTimestamp));
  }

  data(account: Address): Uint8Array | null {
    const found = this.svm.getAccount(account);
    return found.exists ? Uint8Array.from(found.data) : null;
  }

  balance(account: Address): bigint {
    return this.svm.getBalance(account) ?? 0n;
  }

  asset(asset: Address): CoreAssetMarketView {
    const view = decodeCoreAssetForMarket(this.data(asset) ?? new Uint8Array());
    assert.ok(view, `${asset} is a collection asset`);
    return view;
  }

  /** Lets `admin` act as the upgrade authority, as the deployer is on devnet. */
  async makeAdminUpgradeAuthority(): Promise<void> {
    const programData = await programDataAddress(MARKET);
    const account = this.svm.getAccount(programData);
    assert.ok(account.exists, 'LiteSVM loads the market under the upgradeable loader');
    const data = Uint8Array.from(account.data);
    data[12] = 1;
    data.set(getAddressEncoder().encode(this.admin.address), 13);
    this.svm.setAccount({ ...account, data });
  }

  async createCollection(): Promise<Address> {
    const collection = await generateKeyPairSigner();
    const instructions = createCollectionV1(this.umi, {
      collection: createNoopSigner(publicKey(collection.address)),
      payer: createNoopSigner(publicKey(this.admin.address)),
      updateAuthority: publicKey(this.admin.address),
      name: 'BAS District Test',
      uri: 'https://example.invalid/collection.json',
      plugins: [
        {
          plugin: {
            __kind: 'Royalties',
            fields: [{ basisPoints: 500, creators: [{ address: publicKey(this.treasury.address), percentage: 100 }], ruleSet: { __kind: 'None' } }],
          },
          authority: none(),
        },
      ],
    }).getInstructions();
    await this.send(instructions.map(fromUmi), [this.admin, collection]);
    return collection.address;
  }

  async mint(collection: Address, owner: Address, serial: number): Promise<Address> {
    const asset = await generateKeyPairSigner();
    const instructions = createV1(this.umi, {
      asset: createNoopSigner(publicKey(asset.address)),
      collection: publicKey(collection),
      authority: createNoopSigner(publicKey(this.admin.address)),
      payer: createNoopSigner(publicKey(this.admin.address)),
      owner: publicKey(owner),
      name: `BAS #${serial}`,
      uri: `https://example.invalid/templates/7/${serial}-pioneer.json`,
    }).getInstructions();
    await this.send(instructions.map(fromUmi), [this.admin, asset]);
    return asset.address;
  }

  /** A plain Core transfer by the owner, outside the market. */
  async coreTransfer(asset: Address, collection: Address, from: KeyPairSigner, to: Address): Promise<void> {
    const instructions = transferV1(this.umi, {
      asset: publicKey(asset),
      collection: publicKey(collection),
      payer: createNoopSigner(publicKey(from.address)),
      authority: createNoopSigner(publicKey(from.address)),
      newOwner: publicKey(to),
    }).getInstructions();
    await this.send(instructions.map(fromUmi), [from]);
  }

  async freeze(asset: Address, collection: Address, owner: KeyPairSigner): Promise<void> {
    const instructions = addPluginV1(this.umi, {
      asset: publicKey(asset),
      collection: publicKey(collection),
      payer: createNoopSigner(publicKey(owner.address)),
      authority: createNoopSigner(publicKey(owner.address)),
      plugin: { __kind: 'FreezeDelegate', fields: [{ frozen: true }] },
    }).getInstructions();
    await this.send(instructions.map(fromUmi), [owner]);
  }
}

describe('market client against the deployed programs', { skip }, () => {
  let world: World;
  let collection: Address;
  let authority: Address;

  const list = async (asset: Address, seller: KeyPairSigner, priceLamports: bigint, staleListingSeller: Address | null = null) =>
    listForSaleInstructions({
      programId: MARKET,
      seller: seller.address,
      asset,
      collection,
      priceLamports,
      transferDelegate: world.asset(asset).transferDelegate,
      staleListingSeller,
    });

  const marketConfig = async () => {
    const config = decodeMarketConfig(world.data(await marketConfigAddress(MARKET)) ?? new Uint8Array());
    assert.ok(config);
    return config;
  };

  const buy = async (asset: Address, buyer: KeyPairSigner, maxPriceLamports: bigint) => {
    const config = decodeMarketConfig(world.data(await marketConfigAddress(MARKET)) ?? new Uint8Array());
    const listing = decodeListing(world.data(await listingAddress(MARKET, asset)) ?? new Uint8Array());
    assert.ok(config && listing);
    return [await buyInstruction({ programId: MARKET, buyer: buyer.address, asset, seller: listing.seller, config, maxPriceLamports })];
  };

  before(async () => {
    const [admin, treasury, seller, buyer] = await Promise.all([1, 2, 3, 4].map(() => generateKeyPairSigner()));
    world = new World(admin as KeyPairSigner, treasury as KeyPairSigner, seller as KeyPairSigner, buyer as KeyPairSigner);
    authority = await marketAuthorityAddress(MARKET);
    collection = await world.createCollection();
    await world.makeAdminUpgradeAuthority();
  });

  it('reads the Royalties plugin Core wrote on the collection', () => {
    assert.deepEqual(decodeCollectionRoyalties(world.data(collection) ?? new Uint8Array()), {
      basisPoints: 500,
      creators: [{ address: world.treasury.address, percentage: 100 }],
      ruleSet: 'none',
    });
  });

  it('initializes the config as the upgrade authority and opens the market', async () => {
    const init = await initializeMarketConfigInstruction({
      programId: MARKET,
      admin: world.admin.address,
      collection,
      royaltyRecipient: world.treasury.address,
      feeRecipient: world.treasury.address,
      royaltyBps: 500,
      feeBps: 0,
    });
    const intruder = await generateKeyPairSigner();
    world.svm.airdrop(intruder.address, lamports(SOL));
    const refused = await world.attempt(
      [await initializeMarketConfigInstruction({ programId: MARKET, admin: intruder.address, collection, royaltyRecipient: world.treasury.address, feeRecipient: world.treasury.address, royaltyBps: 500, feeBps: 0 })],
      [intruder],
    );
    assert.equal(refused.ok, false, 'only the upgrade authority may initialize');

    await world.send([init], [world.admin]);
    let config = decodeMarketConfig(world.data(await marketConfigAddress(MARKET)) ?? new Uint8Array());
    assert.equal(config?.isPaused, true, 'the market starts paused');
    assert.equal(config?.collection, collection);
    assert.equal(config?.royaltyBps, 500);

    await world.send([await setMarketPausedInstruction({ programId: MARKET, admin: world.admin.address, paused: false })], [world.admin]);
    config = decodeMarketConfig(world.data(await marketConfigAddress(MARKET)) ?? new Uint8Array());
    assert.equal(config?.isPaused, false);
  });

  it('lists, changes the price and sells in one transaction each, with exact payouts', async () => {
    const asset = await world.mint(collection, world.seller.address, 7);
    assert.equal(world.asset(asset).transferDelegate, null);

    const listing = await listingAddress(MARKET, asset);
    const instructions = await list(asset, world.seller, 700_000_000n);
    assert.equal(instructions.length, 2, 'AddPluginV1 and create_listing');
    await world.send(instructions, [world.seller]);
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'address', address: authority });
    assert.equal(decodeListing(world.data(listing) ?? new Uint8Array())?.priceLamports, 700_000_000n);

    await world.send(
      [await updatePriceInstruction({ programId: MARKET, seller: world.seller.address, asset, priceLamports: 650_000_000n })],
      [world.seller],
    );

    // A buyer who saw a lower price is protected: nothing moves.
    const sellerBefore = world.balance(world.seller.address);
    const treasuryBefore = world.balance(world.treasury.address);
    const listingRent = world.balance(listing);
    const tooLow = await world.attempt(await buy(asset, world.buyer, 600_000_000n), [world.buyer]);
    assert.equal(tooLow.ok, false);
    assert.ok(tooLow.logs.some((line) => line.includes(`Error Number: ${6000 + MARKET_ERRORS.indexOf('PriceAboveLimit')}`)));
    assert.equal(world.asset(asset).owner, world.seller.address);

    const logs = await world.send(await buy(asset, world.buyer, 650_000_000n), [world.buyer]);
    assert.equal(world.asset(asset).owner, world.buyer.address);
    assert.equal(world.balance(world.treasury.address) - treasuryBefore, 32_500_000n, '5% royalty');
    assert.equal(world.balance(world.seller.address) - sellerBefore, 617_500_000n + listingRent, 'the rest plus the listing rent');
    assert.equal(world.data(listing), null, 'the listing is closed');
    // Core hands the delegate back to the new owner on every transfer.
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'owner' });
    const consumed = logs.find((line) => line.startsWith(`Program ${MARKET} consumed`));
    assert.ok(consumed, 'the market ran');
    // The event the mission server indexes, read from the program's own log.
    assert.deepEqual(marketEventsFromLogs(logs, MARKET), [
      {
        kind: 'sold',
        asset,
        seller: world.seller.address,
        buyer: world.buyer.address,
        priceLamports: 650_000_000n,
        royaltyLamports: 32_500_000n,
        feeLamports: 0n,
        sellerLamports: 617_500_000n,
      },
    ]);
  });

  it('re-points a delegate the asset already has, and revokes it on cancel', async () => {
    const asset = await world.mint(collection, world.seller.address, 8);
    await world.send(await list(asset, world.seller, 1n * SOL), [world.seller]);
    await world.send(await buy(asset, world.buyer, 1n * SOL), [world.buyer]);
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'owner' });

    const relist = await list(asset, world.buyer, 2n * SOL);
    assert.equal(relist.length, 2, 'ApprovePluginAuthorityV1 and create_listing');
    await world.send(relist, [world.buyer]);
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'address', address: authority });

    const cancel = await cancelSaleInstructions({
      programId: MARKET,
      seller: world.buyer.address,
      asset,
      collection,
      transferDelegate: world.asset(asset).transferDelegate,
    });
    assert.equal(cancel.length, 2);
    await world.send(cancel, [world.buyer]);
    assert.equal(world.data(await listingAddress(MARKET, asset)), null);
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'owner' });
  });

  it('lets the next owner clear a listing the previous owner left behind', async () => {
    const asset = await world.mint(collection, world.seller.address, 9);
    await world.send(await list(asset, world.seller, 1n * SOL), [world.seller]);
    await world.coreTransfer(asset, collection, world.seller, world.buyer.address);
    assert.equal(world.asset(asset).owner, world.buyer.address);

    // Without the stale listing closed first, create_listing cannot reuse the address.
    const blocked = await world.attempt(await list(asset, world.buyer, 1n * SOL), [world.buyer]);
    assert.equal(blocked.ok, false);

    const sellerBefore = world.balance(world.seller.address);
    const rent = world.balance(await listingAddress(MARKET, asset));
    const instructions = await list(asset, world.buyer, 3n * SOL, world.seller.address);
    assert.equal(instructions.length, 3);
    await world.send(instructions, [world.buyer]);
    assert.equal(world.balance(world.seller.address) - sellerBefore, rent, 'the old seller gets the rent back');
    const listing = decodeListing(world.data(await listingAddress(MARKET, asset)) ?? new Uint8Array());
    assert.equal(listing?.seller, world.buyer.address);
    assert.equal(listing?.priceLamports, 3n * SOL);
  });

  it('sees a frozen asset, and the sale of one fails without moving anything', async () => {
    const asset = await world.mint(collection, world.seller.address, 10);
    await world.send(await list(asset, world.seller, 1n * SOL), [world.seller]);
    await world.freeze(asset, collection, world.seller);
    assert.equal(world.asset(asset).frozen, true);
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'address', address: authority });

    const buyerBefore = world.balance(world.buyer.address);
    const result = await world.attempt(await buy(asset, world.buyer, 1n * SOL), [world.buyer]);
    assert.equal(result.ok, false);
    assert.equal(world.asset(asset).owner, world.seller.address);
    assert.ok(buyerBefore - world.balance(world.buyer.address) < 100_000n, 'only the fee is spent');
  });

  it('takes back a delegate another program holds before listing', async () => {
    const asset = await world.mint(collection, world.seller.address, 11);
    const elsewhere = await generateKeyPairSigner();
    await world.send(
      pointPluginInstructions({ asset, collection, owner: world.seller.address, plugin: 'transferDelegate', delegate: elsewhere.address, current: null }),
      [world.seller],
    );
    const instructions = await list(asset, world.seller, 1n * SOL);
    assert.equal(instructions.length, 3, 'RevokePluginAuthorityV1, ApprovePluginAuthorityV1, create_listing');
    await world.send(instructions, [world.seller]);
    assert.deepEqual(world.asset(asset).transferDelegate, { kind: 'address', address: authority });
  });

  it('runs an auction: held by the market, bids paid back when outbid, a late bid extends it, and settling pays everyone', async () => {
    const asset = await world.mint(collection, world.seller.address, 12);
    const start = await startAuctionInstructions({
      programId: MARKET,
      seller: world.seller.address,
      asset,
      collection,
      startPriceLamports: 100_000_000n,
      durationHours: 24,
    });
    assert.equal(start.length, 1, 'create_auction alone');
    const created = await world.send(start, [world.seller]);
    assert.deepEqual(marketEventsFromLogs(created, MARKET).map((event) => event.kind), ['auctionCreated']);
    assert.equal(world.asset(asset).owner, authority, 'the market holds the citizen');
    assert.equal(world.asset(asset).frozen, false);

    const auctionKey = await auctionAddress(MARKET, asset);
    const auction = () => {
      const decoded = decodeAuction(world.data(auctionKey) ?? new Uint8Array());
      assert.ok(decoded);
      return decoded;
    };
    const bid = async (bidder: KeyPairSigner, amountLamports: bigint) =>
      world.attempt(
        [await placeBidInstruction({ programId: MARKET, bidder: bidder.address, asset, amountLamports, previousBidder: auction().highestBidder })],
        [bidder],
      );

    const buyerBefore = world.balance(world.buyer.address);
    assert.ok((await bid(world.buyer, 100_000_000n)).ok);
    const third = await generateKeyPairSigner();
    world.svm.airdrop(third.address, lamports(10n * SOL));
    const outbid = await bid(third, 105_000_000n);
    assert.ok(outbid.ok);
    assert.deepEqual(marketEventsFromLogs(outbid.logs, MARKET), [
      {
        kind: 'bidPlaced',
        asset,
        bidder: third.address,
        amountLamports: 105_000_000n,
        previousBidder: world.buyer.address,
        refundedLamports: 100_000_000n,
        endsAt: auction().endsAt,
      },
    ]);
    // The outbid bidder is back to where they were, less two network fees.
    assert.ok(buyerBefore - world.balance(world.buyer.address) < 20_000n);

    // With a bid in, the seller can no longer take the citizen back.
    const view = world.asset(asset);
    const cancel = await world.attempt(
      await cancelAuctionInstructions({
        programId: MARKET,
        seller: world.seller.address,
        asset,
        collection,
        transferDelegate: view.transferDelegate,
        freezeDelegate: view.freezeDelegate,
      }),
      [world.seller],
    );
    assert.equal(cancel.ok, false);
    assert.ok(cancel.logs.some((line) => line.includes(`Error Number: ${6000 + MARKET_ERRORS.indexOf('AuctionHasBids')}`)));
    assert.equal(world.asset(asset).owner, authority);

    const endsAt = BigInt(auction().endsAt);
    world.setTime(endsAt - 30n);
    assert.ok((await bid(world.buyer, 200_000_000n)).ok);
    assert.equal(BigInt(auction().endsAt), endsAt - 30n + BigInt(clock.extensionSeconds), 'the late-bid window again');

    const early = await world.attempt(
      [await settleAuctionInstruction({ programId: MARKET, caller: third.address, auction: auction(), config: (await marketConfig()) })],
      [third],
    );
    assert.equal(early.ok, false, 'not before the end');

    world.setTime(BigInt(auction().endsAt));
    const sellerBefore = world.balance(world.seller.address);
    const treasuryBefore = world.balance(world.treasury.address);
    const rent = world.balance(auctionKey) - 200_000_000n;
    const settled = await world.send(
      [await settleAuctionInstruction({ programId: MARKET, caller: third.address, auction: auction(), config: await marketConfig() })],
      [third],
    );
    assert.equal(world.asset(asset).owner, world.buyer.address);
    assert.equal(world.balance(world.treasury.address) - treasuryBefore, 10_000_000n);
    assert.equal(world.balance(world.seller.address) - sellerBefore, 190_000_000n + rent);
    assert.equal(world.data(auctionKey), null);
    const [event] = marketEventsFromLogs(settled, MARKET);
    assert.equal(event?.kind, 'auctionSettled');
    assert.ok(event?.kind === 'auctionSettled' && event.delivered && event.winner === world.buyer.address && event.sellerLamports === 190_000_000n);
  });

  it('cancels an auction nobody bid on and hands the citizen back', async () => {
    const asset = await world.mint(collection, world.seller.address, 13);
    await world.send(
      await startAuctionInstructions({
        programId: MARKET,
        seller: world.seller.address,
        asset,
        collection,
        startPriceLamports: 100_000_000n,
        durationHours: 72,
      }),
      [world.seller],
    );
    const view = world.asset(asset);
    const cancel = await cancelAuctionInstructions({
      programId: MARKET,
      seller: world.seller.address,
      asset,
      collection,
      transferDelegate: view.transferDelegate,
      freezeDelegate: view.freezeDelegate,
    });
    assert.equal(cancel.length, 1, 'cancel_auction alone');
    await world.send(cancel, [world.seller]);
    assert.equal(world.asset(asset).owner, world.seller.address);
    assert.equal(world.data(await auctionAddress(MARKET, asset)), null);
    await world.send(await list(asset, world.seller, 1n * SOL), [world.seller]);
  });

  it('holds an offer, replaces it, and the owner accepts it with the listing closing in the same step', async () => {
    const asset = await world.mint(collection, world.seller.address, 14);
    await world.send(await list(asset, world.seller, 2n * SOL), [world.seller]);
    const offerKey = await offerAddress(MARKET, asset, world.buyer.address);
    const make = (amountLamports: bigint, days: 1 | 3 | 7) =>
      makeOfferInstruction({ programId: MARKET, buyer: world.buyer.address, asset, amountLamports, days });

    const buyerBefore = world.balance(world.buyer.address);
    await world.send([await make(300_000_000n, 3)], [world.buyer]);
    const rent = world.balance(offerKey) - 300_000_000n;
    let offer = decodeOffer(world.data(offerKey) ?? new Uint8Array());
    assert.ok(offer);
    assert.equal(offer.expiresAt - offer.madeAt, 3 * 24 * clock.hourSeconds);
    const made = await world.send([await make(250_000_000n, 7)], [world.buyer]);
    assert.equal(world.balance(offerKey), rent + 250_000_000n, 'the offer holds only the new amount');
    const [event] = marketEventsFromLogs(made, MARKET);
    assert.ok(event?.kind === 'offerMade' && event.previousAmountLamports === 300_000_000n);

    const config = await marketConfig();
    const accept = (amountLamports: bigint) =>
      acceptOfferInstruction({ programId: MARKET, owner: world.seller.address, buyer: world.buyer.address, asset, amountLamports, listed: true, config });
    const changed = await world.attempt([await accept(300_000_000n)], [world.seller]);
    assert.ok(!changed.ok && changed.logs.some((line) => line.includes('OfferChanged')), 'the owner saw another amount');

    const sellerBefore = world.balance(world.seller.address);
    const accepted = await world.send([await accept(250_000_000n)], [world.seller]);
    assert.equal(world.asset(asset).owner, world.buyer.address);
    assert.equal(world.data(offerKey), null);
    assert.equal(world.data(await listingAddress(MARKET, asset)), null, 'the listing closed with the sale');
    const [sale] = marketEventsFromLogs(accepted, MARKET);
    assert.ok(sale?.kind === 'offerAccepted' && sale.sellerLamports === 237_500_000n && sale.royaltyLamports === 12_500_000n);
    // The seller paid this transaction's fee; the proceeds and the listing's rent came in.
    assert.ok(world.balance(world.seller.address) > sellerBefore + 237_500_000n);
    // Two transactions' fees aside, the buyer paid the offer and nothing more: the rent came back.
    assert.equal(buyerBefore - world.balance(world.buyer.address), 250_000_000n + 2n * 5_000n);
  });

  it("pays an offer back to its buyer on withdrawal, and to anyone's call once it expired", async () => {
    const asset = await world.mint(collection, world.seller.address, 15);
    const offerKey = await offerAddress(MARKET, asset, world.buyer.address);
    const make = await makeOfferInstruction({ programId: MARKET, buyer: world.buyer.address, asset, amountLamports: 100_000_000n, days: 1 });
    await world.send([make], [world.buyer]);
    await world.send([await withdrawOfferInstruction({ programId: MARKET, buyer: world.buyer.address, asset })], [world.buyer]);
    assert.equal(world.data(offerKey), null);

    await world.send([make], [world.buyer]);
    const offer = decodeOffer(world.data(offerKey) ?? new Uint8Array());
    assert.ok(offer);
    const close = await closeExpiredOfferInstruction({ programId: MARKET, buyer: world.buyer.address, asset, caller: world.seller.address });
    const early = await world.attempt([close], [world.seller]);
    assert.ok(!early.ok && early.logs.some((line) => line.includes('OfferNotExpired')));
    world.setTime(BigInt(offer.expiresAt));
    const held = world.balance(offerKey);
    const buyerBefore = world.balance(world.buyer.address);
    await world.send([close], [world.seller]);
    assert.equal(world.balance(world.buyer.address), buyerBefore + held, 'everything went back to the buyer');
    assert.equal(world.data(offerKey), null);
  });

  it('runs the Core binary that is deployed on devnet', () => {
    assert.ok(world.svm.getAccount(CORE).exists);
  });
});
