import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANDY_MACHINE_LAYOUT,
  CITIZEN_STATE_DISCRIMINATOR,
  CITIZEN_STATE_LAYOUT,
  CORE_CANDY_GUARD_PROGRAM_ID,
  CORE_CANDY_MACHINE_PROGRAM_ID,
  MINT_LIMIT_ID,
  MPL_CORE_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AUCTION_DISCRIMINATOR,
  LISTING_DISCRIMINATOR,
  MARKET_CONFIG_DISCRIMINATOR,
  associatedTokenAddress,
  candyGuardAddress,
  marketAuthorityAddress,
  marketConfigAddress,
  mintCounterAddress,
} from '@bas/chain-client';
import { address, getAddressEncoder } from '@solana/kit';
import { Keypair } from '@solana/web3.js';

import { createReads, type ProgramFilter, type RawAccount, type ReadRpc } from '../src/lib/data/chain/reads.ts';

const PROGRAM = '82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym';
const MINT = '6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG';
const COLLECTION = Keypair.generate().publicKey.toBase58();
const encoder = getAddressEncoder();
const bytesOf = (value: string) => new Uint8Array(encoder.encode(address(value)));
const key = () => Keypair.generate().publicKey.toBase58();

function borshString(value: string): number[] {
  const text = [...new TextEncoder().encode(value)];
  return [text.length & 255, (text.length >> 8) & 255, 0, 0, ...text];
}

function coreAsset(owner: string, collection: string, uri: string): Uint8Array {
  const head = new Uint8Array(66);
  head[0] = 1;
  head.set(bytesOf(owner), 1);
  head[33] = 2;
  head.set(bytesOf(collection), 34);
  return Uint8Array.of(...head, ...borshString('Citizen'), ...borshString(uri), 0);
}

function citizenState(asset: string, scores: [number, number, number], credits: [number, number, number]): Uint8Array {
  const data = new Uint8Array(CITIZEN_STATE_LAYOUT.length);
  const view = new DataView(data.buffer);
  data.set(CITIZEN_STATE_DISCRIMINATOR, 0);
  view.setUint8(8, 1);
  view.setUint32(10, 7, true);
  data.set(bytesOf(asset), 14);
  view.setUint8(46, 2);
  scores.forEach((score, index) => view.setUint8(47 + index, score));
  credits.forEach((credit, index) => view.setUint16(50 + index * 2, credit, true));
  return data;
}

function tokenAccount(mint: string, owner: string, amount: bigint): Uint8Array {
  const data = new Uint8Array(165);
  data.set(bytesOf(mint), 0);
  data.set(bytesOf(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}

/** An RPC that holds accounts and applies the same filters a real node does. */
class FakeRpc implements ReadRpc {
  readonly accounts = new Map<string, RawAccount>();
  readonly lamports = new Map<string, bigint>();
  readonly queries: { program: string; filters: readonly ProgramFilter[]; dataSize: number | undefined }[] = [];

  async programAccounts(program: string, filters: readonly ProgramFilter[], dataSize?: number) {
    this.queries.push({ program, filters, dataSize });
    return [...this.accounts]
      .filter(([, account]) => account.owner === program)
      .filter(([, account]) => dataSize === undefined || account.data.length === dataSize)
      .filter(([, account]) =>
        filters.every((filter) => filter.bytes.every((byte, index) => account.data[filter.offset + index] === byte)),
      )
      .map(([addr, account]) => ({ address: addr, ...account }));
  }

  async account(addr: string) {
    return this.accounts.get(addr) ?? null;
  }

  async balance(addr: string) {
    return this.lamports.get(addr) ?? 0n;
  }
}

describe('reading citizens', () => {
  it('joins the assets of the collection with their district state', async () => {
    const rpc = new FakeRpc();
    const owner = key();
    const [first, second, third, foreign, stray] = [key(), key(), key(), key(), key()];
    rpc.accounts.set(first, { owner: MPL_CORE_PROGRAM_ID, data: coreAsset(owner, COLLECTION, 'https://x.test/templates/7/018-navigator.json') });
    rpc.accounts.set(second, { owner: MPL_CORE_PROGRAM_ID, data: coreAsset(key(), COLLECTION, 'https://x.test/templates/7/001-artisan.json') });
    rpc.accounts.set(third, { owner: MPL_CORE_PROGRAM_ID, data: coreAsset(owner, COLLECTION, 'https://x.test/templates/7/odd.json') });
    // Another collection's asset, and an account of the district program that is not a citizen record.
    rpc.accounts.set(foreign, { owner: MPL_CORE_PROGRAM_ID, data: coreAsset(owner, key(), 'https://x.test/templates/7/002-scholar.json') });
    rpc.accounts.set(key(), { owner: PROGRAM, data: citizenState(first, [2, 0, 1], [1, 2, 3]) });
    rpc.accounts.set(key(), { owner: PROGRAM, data: citizenState(second, [0, 1, 2], [0, 0, 0]) });
    rpc.accounts.set(stray, { owner: PROGRAM, data: new Uint8Array(200) });

    const citizens = await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT }).citizens();
    assert.equal(citizens.length, 3);

    const byAsset = new Map(citizens.map((citizen) => [citizen.asset, citizen]));
    assert.equal(byAsset.get(first)!.owner, owner);
    assert.equal(byAsset.get(first)!.serial, 18);
    assert.deepEqual(
      [byAsset.get(first)!.state!.intelligence, byAsset.get(first)!.state!.bondTrainingCredits, byAsset.get(first)!.state!.craftTrainingCredits],
      [2, 2, 3],
    );
    assert.equal(byAsset.get(second)!.serial, 1);
    assert.equal(byAsset.get(third)!.serial, null, 'a file name that does not follow the naming rule has no serial');
    assert.equal(byAsset.get(third)!.state, null, 'not registered yet');
    assert.equal(byAsset.has(foreign), false);
  });

  it('asks the node only for the collection and for citizen records of the exact size', async () => {
    const rpc = new FakeRpc();
    await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT }).citizens();
    const assets = rpc.queries.find((query) => query.program === MPL_CORE_PROGRAM_ID)!;
    assert.equal(assets.filters[0]!.offset, 34);
    assert.deepEqual([...assets.filters[0]!.bytes], [...bytesOf(COLLECTION)]);
    const states = rpc.queries.find((query) => query.program === PROGRAM)!;
    assert.equal(states.dataSize, CITIZEN_STATE_LAYOUT.length);
    assert.deepEqual([...states.filters[0]!.bytes], [...CITIZEN_STATE_DISCRIMINATOR]);
  });
});

describe('reading balances', () => {
  for (const [name, tokenProgram] of [
    ['SPL Token', TOKEN_PROGRAM_ID],
    ['Token-2022', TOKEN_2022_PROGRAM_ID],
  ] as const) {
    it(`finds the associated token account under ${name}`, async () => {
      const rpc = new FakeRpc();
      const owner = key();
      rpc.accounts.set(MINT, { owner: tokenProgram, data: new Uint8Array(82) });
      rpc.accounts.set(await associatedTokenAddress(address(owner), address(MINT), tokenProgram), {
        owner: tokenProgram,
        data: tokenAccount(MINT, owner, 1_240_000_000n),
      });
      rpc.lamports.set(owner, 2_500_000_000n);
      const reads = createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT });
      assert.deepEqual(await reads.balances(owner), { solLamports: 2_500_000_000n, tokenAtoms: 1_240_000_000n });
    });
  }

  it('reports zero tokens for a wallet without a token account', async () => {
    const rpc = new FakeRpc();
    rpc.accounts.set(MINT, { owner: TOKEN_PROGRAM_ID, data: new Uint8Array(82) });
    const owner = key();
    const reads = createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT });
    assert.deepEqual(await reads.balances(owner), { solLamports: 0n, tokenAtoms: 0n });
  });

  it('fails loudly when the token mint does not exist on the cluster', async () => {
    const reads = createReads({ rpc: new FakeRpc(), programId: PROGRAM, collection: COLLECTION, utilityMint: MINT });
    await assert.rejects(() => reads.balances(key()), /does not exist/);
  });
});

function candyMachine(redeemed: number, available: number): Uint8Array {
  const data = new Uint8Array(CANDY_MACHINE_LAYOUT.minLength);
  const view = new DataView(data.buffer);
  data.set(CANDY_MACHINE_LAYOUT.discriminator, 0);
  view.setBigUint64(CANDY_MACHINE_LAYOUT.itemsRedeemedOffset, BigInt(redeemed), true);
  view.setBigUint64(CANDY_MACHINE_LAYOUT.itemsAvailableOffset, BigInt(available), true);
  return data;
}

describe('reading the sale', () => {
  const machine = key();
  const reads = (rpc: FakeRpc, withMachine = true) =>
    createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT, ...(withMachine ? { candyMachine: machine } : {}) });

  it('reports the real supply and how many this wallet minted', async () => {
    const rpc = new FakeRpc();
    const wallet = key();
    rpc.accounts.set(machine, { owner: CORE_CANDY_MACHINE_PROGRAM_ID, data: candyMachine(3, 10) });
    const counter = await mintCounterAddress({
      id: MINT_LIMIT_ID,
      user: address(wallet),
      candyMachine: address(machine),
      candyGuard: await candyGuardAddress(address(machine)),
    });
    rpc.accounts.set(counter, { owner: CORE_CANDY_GUARD_PROGRAM_ID, data: Uint8Array.of(1, 0) });

    assert.deepEqual(await reads(rpc).sale(wallet), { itemsAvailable: 10, itemsRedeemed: 3, mintedByWallet: 1 });
    // A wallet without a counter has minted nothing, and so has no wallet at all.
    assert.equal((await reads(rpc).sale(key()))?.mintedByWallet, 0);
    assert.equal((await reads(rpc).sale(null))?.mintedByWallet, 0);
  });

  it('reports no sale when the machine is missing, foreign or not configured', async () => {
    const rpc = new FakeRpc();
    assert.equal(await reads(rpc).sale(null), null);
    rpc.accounts.set(machine, { owner: PROGRAM, data: candyMachine(0, 10) });
    assert.equal(await reads(rpc).sale(null), null, 'an account of another program is not a candy machine');
    rpc.accounts.set(machine, { owner: CORE_CANDY_MACHINE_PROGRAM_ID, data: candyMachine(0, 10) });
    assert.equal(await reads(rpc, false).sale(null), null);
  });

  it('ignores a counter that the guard program does not own', async () => {
    const rpc = new FakeRpc();
    const wallet = key();
    rpc.accounts.set(machine, { owner: CORE_CANDY_MACHINE_PROGRAM_ID, data: candyMachine(0, 10) });
    const counter = await mintCounterAddress({
      id: MINT_LIMIT_ID,
      user: address(wallet),
      candyMachine: address(machine),
      candyGuard: await candyGuardAddress(address(machine)),
    });
    rpc.accounts.set(counter, { owner: PROGRAM, data: Uint8Array.of(1, 0) });
    assert.equal((await reads(rpc).sale(wallet))?.mintedByWallet, 0);
  });
});

describe('reading the market', () => {
  const MARKET = 'EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP';
  const u64 = (value: bigint): number[] => {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigInt64(0, value, true);
    return [...out];
  };

  function marketConfig(collection: string, paused: boolean): Uint8Array {
    const recipient = bytesOf(key());
    return Uint8Array.of(
      ...MARKET_CONFIG_DISCRIMINATOR,
      1,
      ...bytesOf(key()),
      ...new Uint8Array(32),
      ...bytesOf(collection),
      0xf4,
      0x01,
      ...recipient,
      0,
      0,
      ...recipient,
      paused ? 1 : 0,
      255,
      254,
    );
  }

  const listing = (asset: string, seller: string, price: bigint): Uint8Array =>
    Uint8Array.of(...LISTING_DISCRIMINATOR, 1, ...bytesOf(asset), ...bytesOf(seller), ...u64(price), ...u64(1_800_000_000n), 255);

  /** An asset whose TransferDelegate plugin names `delegate`. */
  function delegatedAsset(owner: string, delegate: string): Uint8Array {
    const head = coreAsset(owner, COLLECTION, 'https://x.test/templates/7/004-pioneer.json');
    const registryAt = head.length + 9 + 1;
    return Uint8Array.of(...head, 3, ...u64(BigInt(registryAt)), 3, 4, 1, 0, 0, 0, 3, 3, ...bytesOf(delegate), ...u64(BigInt(head.length + 9)), 0, 0, 0, 0);
  }

  it('reports no market without a program id or before the config exists', async () => {
    const rpc = new FakeRpc();
    assert.equal(await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT }).market(), null);
    assert.equal(await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT, marketProgramId: MARKET }).market(), null);
  });

  it('reads the config and the listings, and ignores accounts the program does not own', async () => {
    const rpc = new FakeRpc();
    const configAt = await marketConfigAddress(address(MARKET));
    rpc.accounts.set(configAt, { owner: MARKET, data: marketConfig(COLLECTION, false) });
    const [asset, seller] = [key(), key()];
    rpc.accounts.set(key(), { owner: MARKET, data: listing(asset, seller, 650_000_000n) });
    rpc.accounts.set(key(), { owner: PROGRAM, data: listing(key(), seller, 1n) });
    const reading = await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT, marketProgramId: MARKET }).market();
    assert.ok(reading);
    assert.equal(reading.config.royaltyBps, 500);
    assert.equal(reading.config.isPaused, false);
    assert.equal(reading.authority, await marketAuthorityAddress(address(MARKET)));
    assert.deepEqual(
      reading.listings.map((item) => [item.asset, item.seller, item.priceLamports, item.listedAt]),
      [[asset, seller, 650_000_000n, 1_800_000_000]],
    );
  });

  it('refuses a config for another collection, or one the program does not own', async () => {
    const rpc = new FakeRpc();
    const configAt = await marketConfigAddress(address(MARKET));
    const reads = createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT, marketProgramId: MARKET });
    rpc.accounts.set(configAt, { owner: MARKET, data: marketConfig(key(), false) });
    assert.equal(await reads.market(), null);
    rpc.accounts.set(configAt, { owner: PROGRAM, data: marketConfig(COLLECTION, false) });
    assert.equal(await reads.market(), null);
  });

  it('carries each citizen\'s transfer delegate from the asset account', async () => {
    const rpc = new FakeRpc();
    const [plain, listed, delegate] = [key(), key(), key()];
    rpc.accounts.set(plain, { owner: MPL_CORE_PROGRAM_ID, data: coreAsset(key(), COLLECTION, 'https://x.test/templates/7/003-pioneer.json') });
    rpc.accounts.set(listed, { owner: MPL_CORE_PROGRAM_ID, data: delegatedAsset(key(), delegate) });
    const citizens = await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT }).citizens();
    const byAsset = new Map(citizens.map((citizen) => [citizen.asset, citizen]));
    assert.equal(byAsset.get(plain)?.transferDelegate, null);
    assert.deepEqual(byAsset.get(listed)?.transferDelegate, { kind: 'address', address: delegate });
    assert.equal(byAsset.get(listed)?.serial, 4);
    assert.equal(byAsset.get(listed)?.frozen, false);
  });
  it('reads auctions, with no bidder before the first bid', async () => {
    const rpc = new FakeRpc();
    const configAt = await marketConfigAddress(address(MARKET));
    rpc.accounts.set(configAt, { owner: MARKET, data: marketConfig(COLLECTION, false) });
    const [asset, seller, bidder] = [key(), key(), key()];
    const auction = (bid: bigint, who: Uint8Array | number[], bids: number) =>
      Uint8Array.of(
        ...AUCTION_DISCRIMINATOR,
        1,
        ...bytesOf(asset),
        ...bytesOf(seller),
        ...u64(500_000_000n),
        ...u64(bid),
        ...who,
        ...u64(1_800_000_000n),
        ...u64(1_800_086_400n),
        bids,
        0,
        0,
        0,
        255,
      );
    const at = key();
    rpc.accounts.set(at, { owner: MARKET, data: auction(0n, new Uint8Array(32), 0) });
    rpc.accounts.set(key(), { owner: PROGRAM, data: auction(1n, bytesOf(bidder), 1) });
    const reads = createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT, marketProgramId: MARKET });
    let reading = await reads.market();
    assert.deepEqual(
      reading?.auctions.map((item) => [item.asset, item.seller, item.startPriceLamports, item.highestBidder, item.endsAt, item.bidCount]),
      [[asset, seller, 500_000_000n, null, 1_800_086_400, 0]],
    );
    rpc.accounts.set(at, { owner: MARKET, data: auction(525_000_000n, bytesOf(bidder), 2) });
    reading = await reads.market();
    assert.deepEqual(reading?.auctions.map((item) => [item.highestBidLamports, item.highestBidder, item.bidCount]), [[525_000_000n, bidder, 2]]);
  });

  it('carries the freeze delegate and the frozen flag of a citizen at auction', async () => {
    const rpc = new FakeRpc();
    const [frozen, delegate] = [key(), key()];
    const head = coreAsset(key(), COLLECTION, 'https://x.test/templates/7/004-pioneer.json');
    const freezeAt = head.length + 9;
    const transferAt = freezeAt + 2;
    const registryAt = transferAt + 1;
    rpc.accounts.set(frozen, {
      owner: MPL_CORE_PROGRAM_ID,
      data: Uint8Array.of(
        ...head,
        3,
        ...u64(BigInt(registryAt)),
        1,
        1,
        3,
        4,
        2,
        0,
        0,
        0,
        1,
        3,
        ...bytesOf(delegate),
        ...u64(BigInt(freezeAt)),
        3,
        3,
        ...bytesOf(delegate),
        ...u64(BigInt(transferAt)),
        0,
        0,
        0,
        0,
      ),
    });
    const [citizen] = await createReads({ rpc, programId: PROGRAM, collection: COLLECTION, utilityMint: MINT }).citizens();
    assert.equal(citizen?.frozen, true);
    assert.deepEqual(citizen?.freezeDelegate, { kind: 'address', address: delegate });
    assert.deepEqual(citizen?.transferDelegate, { kind: 'address', address: delegate });
  });
});
