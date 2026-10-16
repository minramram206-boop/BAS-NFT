import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import { AccountRole, address, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import {
  CORE_INSTRUCTION,
  LISTING_DISCRIMINATOR,
  LISTING_LAYOUT,
  MARKET_CONFIG_DISCRIMINATOR,
  MARKET_CONFIG_LAYOUT,
  MARKET_ERRORS,
  MARKET_INSTRUCTION_DISCRIMINATORS,
  MARKET_MAX_PRICE_LAMPORTS,
  MARKET_MIN_PRICE_LAMPORTS,
  MARKET_SEEDS,
  MPL_CORE_PROGRAM_ID,
  buyInstruction,
  cancelListingInstruction,
  cancelSaleInstructions,
  closeStaleListingInstruction,
  createListingInstruction,
  decodeCoreAssetForMarket,
  decodeListing,
  decodeMarketConfig,
  listForSaleInstructions,
  listingAddress,
  marketAuthorityAddress,
  marketConfigAddress,
  marketErrorName,
  updatePriceInstruction,
  AUCTION_CLOCKS,
  AUCTION_DISCRIMINATOR,
  AUCTION_DURATIONS_HOURS,
  AUCTION_EXTENSION_SECONDS,
  auctionClockOf,
  AUCTION_LAYOUT,
  MARKET_EVENT_DISCRIMINATORS,
  MIN_BID_INCREMENT_BPS,
  auctionAddress,
  cancelAuctionInstruction,
  cancelAuctionInstructions,
  createAuctionInstruction,
  decodeAuction,
  decodeMarketEvent,
  marketEventsFromLogs,
  formatSolExact,
  minNextBid,
  placeBidInstruction,
  pointPluginInstructions,
  settleAuctionInstruction,
  startAuctionInstructions,
  MARKET_ADMIN_DISCRIMINATORS,
  decodeUpgradeAuthority,
  initializeMarketConfigInstruction,
  programDataAddress,
  setMarketPausedInstruction,
} from '../dist/index.js';

const source = (file: string): string => readFileSync(join(findRepoRoot(), 'programs/market/src', file), 'utf8');
const PROGRAM = address('EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP');
const SELLER = address('FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk');
const BUYER = address('9DfhjiWco7mDjyiwwSZo9UtyAYqYhjxSw3GyfTmCGEuK');
const ASSET = address('A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn');
const COLLECTION = address('7Cxz7FfrZ5cAeZruPU8wN9fdti4Y97DJgw3y3kXw4jDa');
const TREASURY = address('HmiuFubCzTFA6rYXEb51PTS3SxPNhFuzo5VAXAL4QQua');
const encoder = getAddressEncoder();

const hash8 = (text: string): number[] => [...createHash('sha256').update(text).digest().subarray(0, 8)];

/** Field names, writable and signer flags of an Anchor `Accounts` struct, in declaration order. */
function accountsStruct(file: string, struct: string): { names: string[]; writable: boolean[]; signer: boolean[] } {
  const text = source(`instructions/${file}`);
  const start = text.indexOf(`pub struct ${struct}<'info>`);
  assert.ok(start >= 0, `${struct} in ${file}`);
  const body = text.slice(start, text.indexOf('\n}\n', start));
  const names = [...body.matchAll(/pub (\w+): /g)].map((match) => match[1] as string);
  const blocks = body.split(/\n\n/);
  const writable = names.map((name) => {
    const block = blocks.find((entry) => entry.includes(`pub ${name}:`)) ?? '';
    return /#\[account\(\s*(mut|init)\b/.test(block);
  });
  const signer = names.map((name) => body.includes(`pub ${name}: Signer`));
  return { names, writable, signer };
}

const isWritable = (role: AccountRole): boolean => role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;
const isSigner = (role: AccountRole): boolean => role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER;

function assertMatches(instruction: Instruction, file: string, struct: string, names: string[]): void {
  const expected = accountsStruct(file, struct);
  assert.deepEqual(expected.names, names, `${struct} fields changed`);
  const accounts = instruction.accounts ?? [];
  assert.deepEqual(accounts.map((account) => isWritable(account.role)), expected.writable, `${struct} writable flags`);
  assert.deepEqual(accounts.map((account) => isSigner(account.role)), expected.signer, `${struct} signer flags`);
}

const CONFIG = { collection: COLLECTION, royaltyRecipient: TREASURY, feeRecipient: TREASURY };

describe('market program parity', () => {
  it('uses the Anchor discriminators of the instructions the program declares', () => {
    const lib = source('lib.rs');
    const names = {
      createListing: 'create_listing',
      updatePrice: 'update_price',
      cancelListing: 'cancel_listing',
      closeStaleListing: 'close_stale_listing',
      buy: 'buy',
    } as const;
    for (const [key, name] of Object.entries(names)) {
      assert.ok(lib.includes(`pub fn ${name}(`), name);
      assert.deepEqual([...MARKET_INSTRUCTION_DISCRIMINATORS[key as keyof typeof names]], hash8(`global:${name}`), name);
    }
    assert.deepEqual([...MARKET_CONFIG_DISCRIMINATOR], hash8('account:MarketConfig'));
    assert.deepEqual([...LISTING_DISCRIMINATOR], hash8('account:Listing'));
  });

  it('declares the same program id, seeds and price limits', () => {
    assert.ok(source('lib.rs').includes(`declare_id!("${PROGRAM}")`));
    const constants = source('constants.rs');
    for (const [name, seed] of [
      ['CONFIG_SEED', MARKET_SEEDS.config],
      ['LISTING_SEED', MARKET_SEEDS.listing],
      ['AUTHORITY_SEED', MARKET_SEEDS.authority],
    ]) {
      assert.ok(constants.includes(`pub const ${name}: &[u8] = b"${seed}";`), name);
    }
    const u64 = (name: string): bigint => BigInt((new RegExp(`pub const ${name}: u64 = ([0-9_]+);`).exec(constants)?.[1] ?? 'x').replaceAll('_', ''));
    assert.equal(MARKET_MIN_PRICE_LAMPORTS, u64('MIN_PRICE_LAMPORTS'));
    assert.equal(MARKET_MAX_PRICE_LAMPORTS, u64('MAX_PRICE_LAMPORTS'));
  });

  it('lays the accounts out field by field as the Rust structs do', () => {
    const sizes: Record<string, number> = { u8: 1, bool: 1, u16: 2, u64: 8, i64: 8, Pubkey: 32 };
    const offsets = (file: string, struct: string): Record<string, number> => {
      const text = source(file);
      const body = text.slice(text.indexOf(`pub struct ${struct} {`), text.indexOf('\n}', text.indexOf(`pub struct ${struct} {`)));
      const result: Record<string, number> = {};
      let offset = 8;
      for (const [, name, type] of body.matchAll(/pub (\w+): (\w+),/g)) {
        result[name as string] = offset;
        const size = sizes[type as string];
        assert.ok(size, `${struct}.${name}: ${type}`);
        offset += size;
      }
      result.length = offset;
      return result;
    };
    const config = offsets('state/config.rs', 'MarketConfig');
    assert.deepEqual(MARKET_CONFIG_LAYOUT, {
      versionOffset: config.version,
      adminOffset: config.admin,
      pendingAdminOffset: config.pending_admin,
      collectionOffset: config.collection,
      royaltyBpsOffset: config.royalty_bps,
      royaltyRecipientOffset: config.royalty_recipient,
      feeBpsOffset: config.fee_bps,
      feeRecipientOffset: config.fee_recipient,
      isPausedOffset: config.is_paused,
      bumpOffset: config.bump,
      authorityBumpOffset: config.authority_bump,
      length: config.length,
    });
    const listing = offsets('state/listing.rs', 'Listing');
    assert.deepEqual(LISTING_LAYOUT, {
      versionOffset: listing.version,
      assetOffset: listing.asset,
      sellerOffset: listing.seller,
      priceOffset: listing.price_lamports,
      listedAtOffset: listing.listed_at,
      bumpOffset: listing.bump,
      length: listing.length,
    });
  });

  it('names the error codes in declaration order', () => {
    const variants = [...source('errors.rs').matchAll(/^\s{4}(\w+),$/gm)].map((match) => match[1]);
    assert.deepEqual([...MARKET_ERRORS], variants);
    assert.equal(marketErrorName(6008), 'ListingStale');
    assert.equal(marketErrorName(5999), undefined);
    assert.equal(marketErrorName(6000 + MARKET_ERRORS.length), undefined);
  });

  it('uses the Core instruction numbers next to the TransferV1 the program sends', () => {
    // `core_asset.rs` documents TransferV1 as the fifteenth variant; the plugin
    // instructions sit earlier in the same enum. The metaplex-client tests check
    // every byte against Core's own client.
    assert.ok(source('core_asset.rs').includes('pub const TRANSFER_V1: u8 = 14;'));
    assert.ok(source('core_asset.rs').includes(`pub const UPDATE_PLUGIN_V1: u8 = ${CORE_INSTRUCTION.updatePluginV1};`));
    assert.deepEqual(CORE_INSTRUCTION, { addPluginV1: 2, updatePluginV1: 6, approvePluginAuthorityV1: 8, revokePluginAuthorityV1: 10 });
  });
});

describe('market instructions', () => {
  it('create_listing follows the Accounts struct and encodes the price', async () => {
    const instruction = await createListingInstruction({ programId: PROGRAM, seller: SELLER, asset: ASSET, priceLamports: 650_000_000n });
    assertMatches(instruction, 'create_listing.rs', 'CreateListing', ['config', 'listing', 'asset', 'seller', 'system_program']);
    assert.deepEqual(
      instruction.accounts?.map((account) => account.address),
      [await marketConfigAddress(PROGRAM), await listingAddress(PROGRAM, ASSET), ASSET, SELLER, '11111111111111111111111111111111'],
    );
    assert.deepEqual(
      [...(instruction.data ?? [])],
      [...MARKET_INSTRUCTION_DISCRIMINATORS.createListing, 0x80, 0x36, 0xbe, 0x26, 0, 0, 0, 0],
    );
  });

  it('update_price, cancel_listing and close_stale_listing follow their Accounts structs', async () => {
    assertMatches(
      await updatePriceInstruction({ programId: PROGRAM, seller: SELLER, asset: ASSET, priceLamports: 1n }),
      'update_price.rs',
      'UpdatePrice',
      ['config', 'listing', 'asset', 'seller'],
    );
    assertMatches(await cancelListingInstruction({ programId: PROGRAM, seller: SELLER, asset: ASSET }), 'cancel_listing.rs', 'CancelListing', [
      'listing',
      'seller',
    ]);
    assertMatches(
      await closeStaleListingInstruction({ programId: PROGRAM, asset: ASSET, seller: SELLER, caller: BUYER }),
      'close_stale_listing.rs',
      'CloseStaleListing',
      ['config', 'listing', 'asset', 'seller', 'caller'],
    );
  });

  it('buy follows the Accounts struct and takes the payouts from the config', async () => {
    const instruction = await buyInstruction({
      programId: PROGRAM,
      buyer: BUYER,
      asset: ASSET,
      seller: SELLER,
      config: CONFIG,
      maxPriceLamports: 1_000_000_000n,
    });
    assertMatches(instruction, 'buy.rs', 'Buy', [
      'config',
      'listing',
      'asset',
      'collection',
      'seller',
      'buyer',
      'royalty_recipient',
      'fee_recipient',
      'market_authority',
      'core_program',
      'system_program',
    ]);
    const keys = instruction.accounts?.map((account) => account.address) ?? [];
    assert.equal(keys[3], COLLECTION);
    assert.equal(keys[6], TREASURY);
    assert.equal(keys[8], await marketAuthorityAddress(PROGRAM));
    assert.equal(keys[9], MPL_CORE_PROGRAM_ID);
  });
});

describe('listing and cancelling as one transaction', () => {
  const base = { programId: PROGRAM, seller: SELLER, asset: ASSET, collection: COLLECTION, priceLamports: 650_000_000n };
  const programsOf = (instructions: Instruction[]): string[] =>
    instructions.map((instruction) => `${instruction.programAddress === PROGRAM ? 'market' : 'core'}:${instruction.data?.[0]}`);

  it('adds the delegate plugin when the asset has none', async () => {
    const instructions = await listForSaleInstructions({ ...base, transferDelegate: null });
    assert.deepEqual(programsOf(instructions), [`core:${CORE_INSTRUCTION.addPluginV1}`, `market:${MARKET_INSTRUCTION_DISCRIMINATORS.createListing[0]}`]);
    const delegate = instructions[0]?.data?.slice(4);
    assert.deepEqual([...(delegate ?? [])], [...encoder.encode(await marketAuthorityAddress(PROGRAM))]);
  });

  it('re-points a delegate that is not the market, and leaves one that is', async () => {
    const approve = await listForSaleInstructions({ ...base, transferDelegate: { kind: 'owner' } });
    assert.equal(approve[0]?.data?.[0], CORE_INSTRUCTION.approvePluginAuthorityV1);
    // Held by someone else: Core refuses a direct approve, so it is revoked first.
    const other = await listForSaleInstructions({ ...base, transferDelegate: { kind: 'address', address: BUYER } });
    assert.deepEqual(
      other.slice(0, 2).map((instruction) => instruction.data?.[0]),
      [CORE_INSTRUCTION.revokePluginAuthorityV1, CORE_INSTRUCTION.approvePluginAuthorityV1],
    );
    const already = await listForSaleInstructions({
      ...base,
      transferDelegate: { kind: 'address', address: await marketAuthorityAddress(PROGRAM) },
    });
    assert.equal(already.length, 1);
  });

  it('closes a listing left by a previous owner first', async () => {
    const instructions = await listForSaleInstructions({ ...base, transferDelegate: null, staleListingSeller: BUYER });
    assert.equal(instructions.length, 3);
    assert.deepEqual([...(instructions[0]?.data ?? [])], [...MARKET_INSTRUCTION_DISCRIMINATORS.closeStaleListing]);
    assert.equal(instructions[0]?.accounts?.[3]?.address, BUYER);
    assert.equal(instructions[0]?.accounts?.[4]?.address, SELLER);
  });

  it('revokes the delegate on cancel only while the market holds it', async () => {
    const market = { kind: 'address' as const, address: await marketAuthorityAddress(PROGRAM) };
    const both = await cancelSaleInstructions({ ...base, transferDelegate: market });
    assert.deepEqual(programsOf(both), [`market:${MARKET_INSTRUCTION_DISCRIMINATORS.cancelListing[0]}`, `core:${CORE_INSTRUCTION.revokePluginAuthorityV1}`]);
    assert.equal((await cancelSaleInstructions({ ...base, transferDelegate: { kind: 'owner' } })).length, 1);
    assert.equal((await cancelSaleInstructions({ ...base, transferDelegate: null })).length, 1);
  });
});

// --- decoders -------------------------------------------------------------------------

const bytes = (...parts: (number[] | Uint8Array)[]): Uint8Array => Uint8Array.from(parts.flatMap((part) => [...part]));
const u16 = (value: number): number[] => [value & 0xff, value >> 8];
const u32 = (value: number): number[] => [...new Uint8Array(Uint32Array.of(value).buffer)];
const u64 = (value: bigint): number[] => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, true);
  return [...out];
};
const key = (value: Address): Uint8Array => new Uint8Array(encoder.encode(value));
const str = (value: string): number[] => [...u32(value.length), ...new TextEncoder().encode(value)];

describe('market account decoders', () => {
  it('read a MarketConfig', () => {
    const data = bytes(
      MARKET_CONFIG_DISCRIMINATOR,
      [1],
      key(SELLER),
      key('11111111111111111111111111111111' as Address),
      key(COLLECTION),
      u16(500),
      key(TREASURY),
      u16(0),
      key(TREASURY),
      [1, 254, 253],
    );
    assert.deepEqual(decodeMarketConfig(data), {
      version: 1,
      admin: SELLER,
      pendingAdmin: '11111111111111111111111111111111',
      collection: COLLECTION,
      royaltyBps: 500,
      royaltyRecipient: TREASURY,
      feeBps: 0,
      feeRecipient: TREASURY,
      isPaused: true,
      bump: 254,
      authorityBump: 253,
    });
    assert.equal(decodeMarketConfig(data.subarray(0, 175)), undefined);
    assert.equal(decodeMarketConfig(bytes(LISTING_DISCRIMINATOR, data.subarray(8))), undefined);
  });

  it('read a Listing', () => {
    const data = bytes(LISTING_DISCRIMINATOR, [1], key(ASSET), key(SELLER), u64(650_000_000n), u64(1_792_000_000n), [255]);
    assert.deepEqual(decodeListing(data), {
      version: 1,
      asset: ASSET,
      seller: SELLER,
      priceLamports: 650_000_000n,
      listedAt: 1_792_000_000,
      bump: 255,
    });
    assert.equal(decodeListing(bytes(data, [0])), undefined);
  });
});

describe('Core asset reader for the market', () => {
  const prefix = (seq: number[] = [0]) => bytes([1], key(SELLER), [2], key(COLLECTION), str('BAS #007'), str('https://x/7-pioneer.json'), seq);

  /** An asset with plugins: header, plugin bodies, then the registry. */
  function withPlugins(records: { type: number; authority: number[]; body: number[] }[], seq: number[] = [0]): Uint8Array {
    const head = prefix(seq);
    const headerLength = 9;
    let cursor = head.length + headerLength;
    const placed = records.map((record) => {
      const at = cursor;
      cursor += record.body.length;
      return { ...record, at };
    });
    const registryAt = cursor;
    return bytes(
      head,
      [3],
      u64(BigInt(registryAt)),
      ...placed.map((record) => record.body),
      [4],
      u32(records.length),
      ...placed.map((record) => [record.type, ...record.authority, ...u64(BigInt(record.at))]),
      u32(0),
    );
  }

  it('reads owner and collection of an asset without plugins', () => {
    assert.deepEqual(decodeCoreAssetForMarket(prefix()), {
      owner: SELLER,
      collection: COLLECTION,
      transferDelegate: null,
      freezeDelegate: null,
      frozen: false,
    });
    assert.deepEqual(decodeCoreAssetForMarket(prefix([1, ...u64(9n)]))?.owner, SELLER);
  });

  it('finds the transfer delegate and a freeze among other plugins', () => {
    const asset = withPlugins([
      { type: 6, authority: [2], body: [6, ...u32(0)] },
      { type: 1, authority: [1], body: [1, 1] },
      { type: 3, authority: [3, ...key(BUYER)], body: [3] },
    ]);
    assert.deepEqual(decodeCoreAssetForMarket(asset), {
      owner: SELLER,
      collection: COLLECTION,
      transferDelegate: { kind: 'address', address: BUYER },
      freezeDelegate: { kind: 'owner' },
      frozen: true,
    });
    const thawed = withPlugins([{ type: 1, authority: [1], body: [1, 0] }, { type: 3, authority: [1], body: [3] }]);
    assert.deepEqual(decodeCoreAssetForMarket(thawed)?.transferDelegate, { kind: 'owner' });
    assert.equal(decodeCoreAssetForMarket(thawed)?.frozen, false);
  });

  it('refuses malformed bytes and assets outside a collection', () => {
    const good = withPlugins([{ type: 3, authority: [3, ...key(BUYER)], body: [3] }]);
    // Cut right after the asset fields, the bytes are a valid asset without plugins.
    const plain = prefix().length;
    for (let cut = 1; cut < good.length; cut += 1) {
      if (cut !== plain) assert.equal(decodeCoreAssetForMarket(good.subarray(0, cut)), undefined, `cut ${cut}`);
    }
    const noCollection = bytes([1], key(SELLER), [1], str('a'), str('b'), [0]);
    assert.equal(decodeCoreAssetForMarket(noCollection), undefined);
    const badAuthority = withPlugins([{ type: 3, authority: [9], body: [3] }]);
    assert.equal(decodeCoreAssetForMarket(badAuthority), undefined);
  });
});

describe('market admin instructions', () => {
  it('initialize_config and set_paused follow their Accounts structs', async () => {
    assert.deepEqual([...MARKET_ADMIN_DISCRIMINATORS.initializeConfig], hash8('global:initialize_config'));
    assert.deepEqual([...MARKET_ADMIN_DISCRIMINATORS.setPaused], hash8('global:set_paused'));
    const init = await initializeMarketConfigInstruction({
      programId: PROGRAM,
      admin: BUYER,
      collection: COLLECTION,
      royaltyRecipient: TREASURY,
      feeRecipient: TREASURY,
      royaltyBps: 500,
      feeBps: 0,
    });
    assertMatches(init, 'initialize_config.rs', 'InitializeConfig', [
      'config',
      'collection',
      'royalty_recipient',
      'fee_recipient',
      'program_data',
      'admin',
      'system_program',
    ]);
    assert.equal(init.accounts?.[4]?.address, await programDataAddress(PROGRAM));
    // InitializeConfigArgs { royalty_bps: u16, fee_bps: u16 }
    assert.deepEqual([...(init.data ?? []).slice(8)], [0xf4, 0x01, 0, 0]);
    assert.ok(source('instructions/initialize_config.rs').includes('pub royalty_bps: u16,\n    pub fee_bps: u16,'));

    const pause = await setMarketPausedInstruction({ programId: PROGRAM, admin: BUYER, paused: false });
    assertMatches(pause, 'set_paused.rs', 'SetPaused', ['config', 'admin']);
    assert.equal(pause.data?.[8], 0);
  });

  it('reads the upgrade authority of a ProgramData account', () => {
    const data = bytes([3, 0, 0, 0], u64(42n), [1], key(BUYER), [0x7f, 0x45]);
    assert.equal(decodeUpgradeAuthority(data), BUYER);
    assert.equal(decodeUpgradeAuthority(bytes([3, 0, 0, 0], u64(42n), [0], new Uint8Array(32))), null);
    assert.equal(decodeUpgradeAuthority(bytes([2, 0, 0, 0], u64(42n), [1], key(BUYER))), null);
  });
});

// --- auctions ----------------------------------------------------------------------------

describe('auction parity', () => {
  it('uses the discriminators, constants and layout of the program', () => {
    const names = { createAuction: 'create_auction', placeBid: 'place_bid', cancelAuction: 'cancel_auction', settleAuction: 'settle_auction' } as const;
    for (const [field, name] of Object.entries(names)) {
      assert.ok(source('lib.rs').includes(`pub fn ${name}(`), name);
      assert.deepEqual([...MARKET_INSTRUCTION_DISCRIMINATORS[field as keyof typeof names]], hash8(`global:${name}`), name);
    }
    assert.deepEqual([...AUCTION_DISCRIMINATOR], hash8('account:Auction'));
    for (const [name, bytes] of Object.entries(MARKET_EVENT_DISCRIMINATORS)) assert.deepEqual([...bytes], hash8(`event:${name}`), name);

    const constants = source('constants.rs');
    assert.ok(constants.includes('pub const AUCTION_SEED: &[u8] = b"auction";'));
    assert.ok(constants.includes(`pub const AUCTION_DURATIONS_HOURS: [u8; 3] = [${AUCTION_DURATIONS_HOURS.join(', ')}];`));
    assert.ok(constants.includes(`pub const MIN_BID_INCREMENT_BPS: u64 = ${MIN_BID_INCREMENT_BPS};`));

    // Each clock constant is written twice in constants.rs, once per side of the `devnet-clock` feature.
    const clockValue = (name: string, fast: boolean): number => {
      const cfg = fast ? '#[cfg(feature = "devnet-clock")]' : '#[cfg(not(feature = "devnet-clock"))]';
      const found = new RegExp(`${cfg.replace(/[[\]()]/g, '\\$&')}\\s*pub const ${name}: i64 = ([\\d_]+);`).exec(constants);
      assert.ok(found, `${name} ${fast ? 'fast' : 'real'}`);
      return Number((found[1] as string).replaceAll('_', ''));
    };
    for (const [name, clock] of [
      ['real', AUCTION_CLOCKS.real],
      ['devnet-fast', AUCTION_CLOCKS['devnet-fast']],
    ] as const) {
      const fast = name === 'devnet-fast';
      assert.equal(clockValue('AUCTION_HOUR_SECONDS', fast), clock.hourSeconds, name);
      assert.equal(clockValue('AUCTION_EXTENSION_SECONDS', fast), clock.extensionSeconds, name);
    }
    assert.equal(AUCTION_EXTENSION_SECONDS, AUCTION_CLOCKS.real.extensionSeconds);
    assert.equal(auctionClockOf(undefined), AUCTION_CLOCKS.real);
    assert.equal(auctionClockOf('devnet-fast'), AUCTION_CLOCKS['devnet-fast']);

    const text = source('state/auction.rs');
    const body = text.slice(text.indexOf('pub struct Auction {'), text.indexOf('\n}', text.indexOf('pub struct Auction {')));
    const sizes: Record<string, number> = { u8: 1, u32: 4, u64: 8, i64: 8, Pubkey: 32 };
    const offsets: Record<string, number> = {};
    let offset = 8;
    for (const [, name, type] of body.matchAll(/pub (\w+): (\w+),/g)) {
      offsets[name as string] = offset;
      offset += sizes[type as string] as number;
    }
    assert.deepEqual(AUCTION_LAYOUT, {
      versionOffset: offsets.version,
      assetOffset: offsets.asset,
      sellerOffset: offsets.seller,
      startPriceOffset: offsets.start_price_lamports,
      highestBidOffset: offsets.highest_bid_lamports,
      highestBidderOffset: offsets.highest_bidder,
      startedAtOffset: offsets.started_at,
      endsAtOffset: offsets.ends_at,
      bidCountOffset: offsets.bid_count,
      bumpOffset: offsets.bump,
      length: offset,
    });
  });

  it('lays out the events field by field as events.rs declares them', () => {
    const text = source('events.rs');
    const fields = (name: string): string[] => {
      const start = text.indexOf(`pub struct ${name} {`);
      return [...text.slice(start, text.indexOf('\n}', start)).matchAll(/pub (\w+): (\w+),/g)].map(([, field, type]) => `${field}:${type}`);
    };
    assert.deepEqual(fields('Sold'), ['asset:Pubkey', 'seller:Pubkey', 'buyer:Pubkey', 'price_lamports:u64', 'royalty_lamports:u64', 'fee_lamports:u64', 'seller_lamports:u64']);
    assert.deepEqual(fields('AuctionSettled'), [
      'asset:Pubkey', 'seller:Pubkey', 'winner:Pubkey', 'price_lamports:u64', 'royalty_lamports:u64', 'fee_lamports:u64', 'seller_lamports:u64', 'delivered:bool',
    ]);
    assert.deepEqual(fields('BidPlaced'), ['asset:Pubkey', 'bidder:Pubkey', 'amount_lamports:u64', 'previous_bidder:Pubkey', 'refunded_lamports:u64', 'ends_at:i64']);
    assert.deepEqual(fields('AuctionCreated'), ['asset:Pubkey', 'seller:Pubkey', 'start_price_lamports:u64', 'ends_at:i64']);
    assert.deepEqual(fields('AuctionCancelled'), ['asset:Pubkey', 'seller:Pubkey']);
  });

  it('asks for the same next bid as the program', () => {
    assert.equal(minNextBid(10_000_000n, null), 10_000_000n);
    assert.equal(minNextBid(10_000_000n, 100_000_000n), 105_000_000n);
    assert.equal(minNextBid(1n, 10_000_001n), 10_500_002n);
    assert.equal(minNextBid(1n, 1n), 2n);
    // The same cases as `sale.rs`.
    const rust = source('sale.rs');
    assert.ok(rust.includes('assert_eq!(min_next_bid(1, 10_000_001, true), Some(10_500_002));'));
  });

  it('writes SOL amounts without losing a digit', () => {
    assert.equal(formatSolExact(650_000_000n), '0.65 SOL');
    assert.equal(formatSolExact(15_000_000n), '0.015 SOL');
    assert.equal(formatSolExact(2_000_000_000n), '2.00 SOL');
    assert.equal(formatSolExact(1_000_000_000_000n), '1,000.00 SOL');
    assert.equal(formatSolExact(12_123_456_789n), '12.123456789 SOL');
  });
});

describe('auction instructions', () => {
  const AUCTION_CONFIG = { collection: COLLECTION, royaltyRecipient: TREASURY, feeRecipient: TREASURY };

  it('follow the Accounts structs', async () => {
    assertMatches(
      await createAuctionInstruction({ programId: PROGRAM, seller: SELLER, asset: ASSET, collection: COLLECTION, startPriceLamports: 1n, durationHours: 48 }),
      'create_auction.rs',
      'CreateAuction',
      ['config', 'auction', 'listing', 'asset', 'collection', 'seller', 'market_authority', 'core_program', 'system_program'],
    );
    assertMatches(
      await placeBidInstruction({ programId: PROGRAM, bidder: BUYER, asset: ASSET, amountLamports: 1n, previousBidder: SELLER }),
      'place_bid.rs',
      'PlaceBid',
      ['config', 'auction', 'asset', 'bidder', 'previous_bidder', 'market_authority', 'system_program'],
    );
    assertMatches(
      await cancelAuctionInstruction({ programId: PROGRAM, seller: SELLER, asset: ASSET, collection: COLLECTION }),
      'cancel_auction.rs',
      'CancelAuction',
      ['config', 'auction', 'asset', 'collection', 'seller', 'market_authority', 'core_program', 'system_program'],
    );
    assertMatches(
      await settleAuctionInstruction({ programId: PROGRAM, caller: BUYER, auction: { asset: ASSET, seller: SELLER, highestBidder: TREASURY }, config: AUCTION_CONFIG }),
      'settle_auction.rs',
      'SettleAuction',
      [
        'config', 'auction', 'asset', 'collection', 'seller', 'winner', 'royalty_recipient', 'fee_recipient', 'market_authority', 'core_program', 'caller', 'system_program',
      ],
    );
  });

  it('encode the arguments and pass the program id for an absent optional account', async () => {
    const create = await createAuctionInstruction({ programId: PROGRAM, seller: SELLER, asset: ASSET, collection: COLLECTION, startPriceLamports: 650_000_000n, durationHours: 72 });
    assert.deepEqual([...(create.data ?? [])], [...MARKET_INSTRUCTION_DISCRIMINATORS.createAuction, 0x80, 0x36, 0xbe, 0x26, 0, 0, 0, 0, 72]);
    assert.equal(create.accounts?.[1]?.address, await auctionAddress(PROGRAM, ASSET));
    assert.equal(create.accounts?.[2]?.address, await listingAddress(PROGRAM, ASSET));

    const first = await placeBidInstruction({ programId: PROGRAM, bidder: BUYER, asset: ASSET, amountLamports: 5n, previousBidder: null });
    assert.deepEqual(first.accounts?.[4], { address: PROGRAM, role: AccountRole.READONLY });
    const settle = await settleAuctionInstruction({ programId: PROGRAM, caller: BUYER, auction: { asset: ASSET, seller: SELLER, highestBidder: null }, config: AUCTION_CONFIG });
    assert.deepEqual(settle.accounts?.[5], { address: PROGRAM, role: AccountRole.READONLY });
  });

  it('point a plugin at the market with nothing, an add, an approve, or a revoke then an approve', async () => {
    const authority = await marketAuthorityAddress(PROGRAM);
    const core = { asset: ASSET, collection: COLLECTION, owner: SELLER, delegate: authority };
    const shape = (current: Parameters<typeof pointPluginInstructions>[0]['current'], plugin: 'transferDelegate' | 'freezeDelegate' = 'freezeDelegate') =>
      pointPluginInstructions({ ...core, plugin, current }).map((instruction) => [...(instruction.data ?? [])].slice(0, 3));
    assert.deepEqual(shape(null), [[2, 1, 0]], 'AddPluginV1 FreezeDelegate { frozen: false }');
    assert.deepEqual(shape({ kind: 'owner' }), [[8, 1, 3]]);
    assert.deepEqual(shape({ kind: 'address', address: BUYER }), [[10, 1], [8, 1, 3]]);
    assert.deepEqual(shape({ kind: 'address', address: authority }), []);
    assert.deepEqual(shape({ kind: 'address', address: BUYER }, 'transferDelegate'), [[10, 3], [8, 3, 3]]);
  });

  it('start an auction with create_auction alone, after any stale listing', async () => {
    const start = await startAuctionInstructions({
      programId: PROGRAM,
      seller: SELLER,
      asset: ASSET,
      collection: COLLECTION,
      startPriceLamports: 10_000_000n,
      durationHours: 24,
      staleListingSeller: BUYER,
    });
    const tag = (name: keyof typeof MARKET_INSTRUCTION_DISCRIMINATORS) =>
      `market:${MARKET_INSTRUCTION_DISCRIMINATORS[name][0]}:${MARKET_INSTRUCTION_DISCRIMINATORS[name][1]}`;
    assert.deepEqual(
      start.map((instruction) => `${instruction.programAddress === PROGRAM ? 'market' : 'core'}:${instruction.data?.[0]}:${instruction.data?.[1]}`),
      [tag('closeStaleListing'), tag('createAuction')],
    );
  });

  it('cancel an auction, revoking only delegates an older auction left with the market', async () => {
    const authority = await marketAuthorityAddress(PROGRAM);
    const input = { programId: PROGRAM, seller: SELLER, asset: ASSET, collection: COLLECTION };
    const escrowed = await cancelAuctionInstructions({ ...input, transferDelegate: { kind: 'owner' }, freezeDelegate: null });
    assert.equal(escrowed.length, 1, 'the market hands the citizen back; nothing to revoke');
    const held = { kind: 'address' as const, address: authority };
    const older = await cancelAuctionInstructions({ ...input, transferDelegate: held, freezeDelegate: held });
    assert.deepEqual(older.slice(1).map((instruction) => [...(instruction.data ?? [])]), [[10, 1], [10, 3]]);
    const revoked = await cancelAuctionInstructions({ ...input, transferDelegate: { kind: 'owner' }, freezeDelegate: held });
    assert.equal(revoked.length, 2, 'a delegate the seller already took back is not revoked again');
  });
});

describe('auction account and events', () => {
  it('reads an Auction, with no bidder until the first bid', () => {
    const data = bytes(AUCTION_DISCRIMINATOR, [1], key(ASSET), key(SELLER), u64(10_000_000n), u64(0n), new Uint8Array(32), u64(1_800_000_000n), u64(1_800_086_400n), u32(0), [254]);
    assert.deepEqual(decodeAuction(data), {
      version: 1,
      asset: ASSET,
      seller: SELLER,
      startPriceLamports: 10_000_000n,
      highestBidLamports: 0n,
      highestBidder: null,
      startedAt: 1_800_000_000,
      endsAt: 1_800_086_400,
      bidCount: 0,
      bump: 254,
    });
    const bid = bytes(AUCTION_DISCRIMINATOR, [1], key(ASSET), key(SELLER), u64(10_000_000n), u64(12_000_000n), key(BUYER), u64(1n), u64(2n), u32(3), [254]);
    assert.equal(decodeAuction(bid)?.highestBidder, BUYER);
    assert.equal(decodeAuction(bid)?.bidCount, 3);
    assert.equal(decodeAuction(bid.subarray(0, 141)), undefined);
  });

  const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64');
  const sold = bytes(MARKET_EVENT_DISCRIMINATORS.Sold, key(ASSET), key(SELLER), key(BUYER), u64(100_000_000n), u64(5_000_000n), u64(0n), u64(95_000_000n));

  it('decodes sales and bids', () => {
    assert.deepEqual(decodeMarketEvent(sold), {
      kind: 'sold', asset: ASSET, seller: SELLER, buyer: BUYER, priceLamports: 100_000_000n, royaltyLamports: 5_000_000n, feeLamports: 0n, sellerLamports: 95_000_000n,
    });
    const settled = bytes(MARKET_EVENT_DISCRIMINATORS.AuctionSettled, key(ASSET), key(SELLER), new Uint8Array(32), u64(0n), u64(0n), u64(0n), u64(0n), [0]);
    assert.deepEqual(decodeMarketEvent(settled), {
      kind: 'auctionSettled', asset: ASSET, seller: SELLER, winner: null, priceLamports: 0n, royaltyLamports: 0n, feeLamports: 0n, sellerLamports: 0n, delivered: false,
    });
    const bid = bytes(MARKET_EVENT_DISCRIMINATORS.BidPlaced, key(ASSET), key(BUYER), u64(12n), key(TREASURY), u64(10n), u64(99n));
    assert.deepEqual(decodeMarketEvent(bid), { kind: 'bidPlaced', asset: ASSET, bidder: BUYER, amountLamports: 12n, previousBidder: TREASURY, refundedLamports: 10n, endsAt: 99 });
    assert.equal(decodeMarketEvent(sold.subarray(1)), undefined);
    assert.equal(decodeMarketEvent(bytes(settled.subarray(0, 136), [2])), undefined);
  });

  it('reads only the events the market program wrote', () => {
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      'Program log: Instruction: Buy',
      `Program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d invoke [2]`,
      `Program data: ${b64(sold)}`,
      `Program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d success`,
      `Program data: ${b64(sold)}`,
      `Program ${PROGRAM} consumed 30000 of 200000 compute units`,
      `Program ${PROGRAM} success`,
      `Program data: ${b64(sold)}`,
      'Program data: not-base64!',
    ];
    const events = marketEventsFromLogs(logs, PROGRAM);
    assert.equal(events.length, 1, 'the line inside Core and the ones outside any program are ignored');
    assert.equal(events[0]?.kind, 'sold');
  });
});

