import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';
import { MPL_CORE_PROGRAM_ID } from './constants.js';
import { SYSTEM_PROGRAM_ID } from './instructions.js';

/**
 * Client for the `market` program (`programs/market`, docs/MARKET.md): its
 * addresses, its account types, its instructions, and the Core plugin
 * instructions a listing needs around them.
 *
 * Layouts and account orders mirror the Rust sources; `test/market.test.ts`
 * reads those files and fails when they drift. The Core instructions are
 * built by hand like the program's own `TransferV1` CPI, and the
 * metaplex-client tests compare them with the official Core client.
 */

const text = new TextEncoder();
const addressBytes = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const CORE = MPL_CORE_PROGRAM_ID as Address;

/** PDA seeds from `programs/market/src/constants.rs`. */
export const MARKET_SEEDS = {
  config: 'market-config',
  listing: 'listing',
  auction: 'auction',
  offer: 'offer',
  authority: 'market-authority',
} as const;

/** Auction rules from `constants.rs`. */
export const AUCTION_DURATIONS_HOURS = [24, 48, 72] as const;
export type AuctionDurationHours = (typeof AUCTION_DURATIONS_HOURS)[number];
export const MIN_BID_INCREMENT_BPS = 500;

/** How long an offer stays open, in days of 24 auction hours (`OFFER_DAYS`). */
export const OFFER_DAYS = [1, 3, 7] as const;
export type OfferDays = (typeof OFFER_DAYS)[number];

/** How fast a deployed market runs its auctions. */
export interface AuctionClock {
  /** Seconds that one hour of an auction lasts. */
  readonly hourSeconds: number;
  /** A bid this close to the end moves the end this long past the bid. */
  readonly extensionSeconds: number;
}

/**
 * The real clock, and the fast one of a market built with its `devnet-clock`
 * feature (`AUCTION_HOUR_SECONDS` and `AUCTION_EXTENSION_SECONDS` in
 * `constants.rs`). The manifest field `auctionClock` names which one a cluster runs.
 */
export const AUCTION_CLOCKS = {
  real: { hourSeconds: 3_600, extensionSeconds: 600 },
  'devnet-fast': { hourSeconds: 10, extensionSeconds: 60 },
} as const satisfies Record<string, AuctionClock>;

/** The clock of a cluster from its manifest's `auctionClock`; the real one when unset. */
export function auctionClockOf(name: 'devnet-fast' | undefined): AuctionClock {
  return name === undefined ? AUCTION_CLOCKS.real : AUCTION_CLOCKS[name];
}

/** The late-bid window of the real clock. */
export const AUCTION_EXTENSION_SECONDS = AUCTION_CLOCKS.real.extensionSeconds;

/**
 * The lowest bid an auction takes next: the start price, then 5% over the
 * highest bid, rounded up and at least one lamport. `highestBidLamports` is
 * `null` before the first bid. Mirrors `min_next_bid` in `sale.rs`.
 */
export function minNextBid(startPriceLamports: bigint, highestBidLamports: bigint | null): bigint {
  if (highestBidLamports === null) return startPriceLamports;
  const step = (highestBidLamports * BigInt(MIN_BID_INCREMENT_BPS) + 9_999n) / 10_000n;
  return highestBidLamports + (step > 0n ? step : 1n);
}

/**
 * Lamports as SOL with every digit that matters and at least two decimals, so
 * `0.015` does not read as `0.01`: `650000000` is `0.65 SOL`, `15000000` is
 * `0.015 SOL`, `1000000000000` is `1,000.00 SOL`.
 */
export function formatSolExact(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${fraction} SOL`;
}

/** `MIN_PRICE_LAMPORTS` and `MAX_PRICE_LAMPORTS` in `constants.rs`. */
export const MARKET_MIN_PRICE_LAMPORTS = 10_000_000n;
export const MARKET_MAX_PRICE_LAMPORTS = 1_000_000_000_000n;

/** Anchor discriminators: the first 8 bytes of `sha256("global:<instruction>")`. */
export const MARKET_INSTRUCTION_DISCRIMINATORS = {
  createListing: Uint8Array.of(18, 168, 45, 24, 191, 31, 117, 54),
  updatePrice: Uint8Array.of(61, 34, 117, 155, 75, 34, 123, 208),
  cancelListing: Uint8Array.of(41, 183, 50, 232, 230, 233, 157, 70),
  closeStaleListing: Uint8Array.of(120, 38, 229, 87, 16, 1, 54, 10),
  buy: Uint8Array.of(102, 6, 61, 18, 1, 218, 235, 234),
  createAuction: Uint8Array.of(234, 6, 201, 246, 47, 219, 176, 107),
  placeBid: Uint8Array.of(238, 77, 148, 91, 200, 151, 92, 146),
  cancelAuction: Uint8Array.of(156, 43, 197, 110, 218, 105, 143, 182),
  settleAuction: Uint8Array.of(246, 196, 183, 98, 222, 139, 46, 133),
  makeOffer: Uint8Array.of(214, 98, 97, 35, 59, 12, 44, 178),
  withdrawOffer: Uint8Array.of(203, 38, 131, 234, 204, 122, 53, 150),
  closeExpiredOffer: Uint8Array.of(174, 202, 24, 79, 174, 99, 110, 236),
  acceptOffer: Uint8Array.of(227, 82, 234, 131, 1, 18, 48, 2),
} as const;

/** First 8 bytes of `sha256("account:MarketConfig")`. */
export const MARKET_CONFIG_DISCRIMINATOR = Uint8Array.of(119, 255, 200, 88, 252, 82, 128, 24);
/** First 8 bytes of `sha256("account:Listing")`. */
export const LISTING_DISCRIMINATOR = Uint8Array.of(218, 32, 50, 73, 43, 134, 26, 58);
/** First 8 bytes of `sha256("account:Auction")`. */
export const AUCTION_DISCRIMINATOR = Uint8Array.of(218, 94, 247, 242, 126, 233, 131, 81);
/** First 8 bytes of `sha256("account:Offer")`. */
export const OFFER_DISCRIMINATOR = Uint8Array.of(215, 88, 60, 71, 170, 162, 73, 229);

/** Byte offsets of `MarketConfig` (`programs/market/src/state/config.rs`). */
export const MARKET_CONFIG_LAYOUT = {
  versionOffset: 8,
  adminOffset: 9,
  pendingAdminOffset: 41,
  collectionOffset: 73,
  royaltyBpsOffset: 105,
  royaltyRecipientOffset: 107,
  feeBpsOffset: 139,
  feeRecipientOffset: 141,
  isPausedOffset: 173,
  bumpOffset: 174,
  authorityBumpOffset: 175,
  length: 176,
} as const;

/** Byte offsets of `Listing` (`programs/market/src/state/listing.rs`). */
export const LISTING_LAYOUT = {
  versionOffset: 8,
  assetOffset: 9,
  sellerOffset: 41,
  priceOffset: 73,
  listedAtOffset: 81,
  bumpOffset: 89,
  length: 90,
} as const;

/** Byte offsets of `Auction` (`programs/market/src/state/auction.rs`). */
export const AUCTION_LAYOUT = {
  versionOffset: 8,
  assetOffset: 9,
  sellerOffset: 41,
  startPriceOffset: 73,
  highestBidOffset: 81,
  highestBidderOffset: 89,
  startedAtOffset: 121,
  endsAtOffset: 129,
  bidCountOffset: 137,
  bumpOffset: 141,
  length: 142,
} as const;

/** Byte offsets of `Offer` (`programs/market/src/state/offer.rs`). */
export const OFFER_LAYOUT = {
  versionOffset: 8,
  assetOffset: 9,
  buyerOffset: 41,
  amountOffset: 73,
  madeAtOffset: 81,
  expiresAtOffset: 89,
  bumpOffset: 97,
  length: 98,
} as const;

/**
 * `MarketError` codes. Anchor numbers them from 6000 in declaration order
 * (`programs/market/src/errors.rs`).
 */
export const MARKET_ERRORS = [
  'Unauthorized',
  'MarketPaused',
  'InvalidConfig',
  'PriceOutOfRange',
  'InvalidAsset',
  'WrongCollection',
  'NotOwner',
  'DelegateMissing',
  'ListingStale',
  'ListingNotStale',
  'PriceAboveLimit',
  'BuyerIsSeller',
  'PriceUnchanged',
  'RecipientNotFunded',
  'Overflow',
  'AssetFrozen',
  'InvalidDuration',
  'FreezeMissing',
  'ListingExists',
  'AuctionEnded',
  'AuctionNotEnded',
  'BidTooLow',
  'AuctionHasBids',
  'AlreadyHighestBidder',
  'WrongBidder',
  'AuctionUndeliverable',
  'InvalidOfferLength',
  'AssetInAuction',
  'OfferExpired',
  'OfferNotExpired',
  'OfferChanged',
] as const;
export type MarketErrorName = (typeof MARKET_ERRORS)[number];

/** The name of a market error code, or `undefined` for any other number. */
export function marketErrorName(code: number): MarketErrorName | undefined {
  return MARKET_ERRORS[code - 6000];
}

export interface MarketConfigOnChain {
  version: number;
  admin: Address;
  pendingAdmin: Address;
  collection: Address;
  royaltyBps: number;
  royaltyRecipient: Address;
  feeBps: number;
  feeRecipient: Address;
  isPaused: boolean;
  bump: number;
  authorityBump: number;
}

export interface ListingOnChain {
  version: number;
  asset: Address;
  seller: Address;
  priceLamports: bigint;
  /** Unix seconds of `create_listing`. */
  listedAt: number;
  bump: number;
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  return data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte);
}

const key = (data: Uint8Array, offset: number): Address => addressDecoder.decode(data.subarray(offset, offset + 32));

export function decodeMarketConfig(data: Uint8Array): MarketConfigOnChain | undefined {
  const layout = MARKET_CONFIG_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, MARKET_CONFIG_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  return {
    version: bytes.getUint8(layout.versionOffset),
    admin: key(data, layout.adminOffset),
    pendingAdmin: key(data, layout.pendingAdminOffset),
    collection: key(data, layout.collectionOffset),
    royaltyBps: bytes.getUint16(layout.royaltyBpsOffset, true),
    royaltyRecipient: key(data, layout.royaltyRecipientOffset),
    feeBps: bytes.getUint16(layout.feeBpsOffset, true),
    feeRecipient: key(data, layout.feeRecipientOffset),
    isPaused: bytes.getUint8(layout.isPausedOffset) !== 0,
    bump: bytes.getUint8(layout.bumpOffset),
    authorityBump: bytes.getUint8(layout.authorityBumpOffset),
  };
}

export interface AuctionOnChain {
  version: number;
  asset: Address;
  seller: Address;
  startPriceLamports: bigint;
  /** Zero until the first bid. */
  highestBidLamports: bigint;
  /** `null` until the first bid. */
  highestBidder: Address | null;
  /** Unix seconds. */
  startedAt: number;
  /** Unix seconds; moves later when a bid lands in the last ten minutes. */
  endsAt: number;
  bidCount: number;
  bump: number;
}

const DEFAULT_ADDRESS = '11111111111111111111111111111111' as Address;

export function decodeAuction(data: Uint8Array): AuctionOnChain | undefined {
  const layout = AUCTION_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, AUCTION_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  const bidder = key(data, layout.highestBidderOffset);
  const bidCount = bytes.getUint32(layout.bidCountOffset, true);
  return {
    version: bytes.getUint8(layout.versionOffset),
    asset: key(data, layout.assetOffset),
    seller: key(data, layout.sellerOffset),
    startPriceLamports: bytes.getBigUint64(layout.startPriceOffset, true),
    highestBidLamports: bytes.getBigUint64(layout.highestBidOffset, true),
    highestBidder: bidCount > 0 && bidder !== DEFAULT_ADDRESS ? bidder : null,
    startedAt: Number(bytes.getBigInt64(layout.startedAtOffset, true)),
    endsAt: Number(bytes.getBigInt64(layout.endsAtOffset, true)),
    bidCount,
    bump: bytes.getUint8(layout.bumpOffset),
  };
}

export function decodeListing(data: Uint8Array): ListingOnChain | undefined {
  const layout = LISTING_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, LISTING_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  const listedAt = bytes.getBigInt64(layout.listedAtOffset, true);
  return {
    version: bytes.getUint8(layout.versionOffset),
    asset: key(data, layout.assetOffset),
    seller: key(data, layout.sellerOffset),
    priceLamports: bytes.getBigUint64(layout.priceOffset, true),
    listedAt: Number(listedAt),
    bump: bytes.getUint8(layout.bumpOffset),
  };
}

// --- Core asset plugins ----------------------------------------------------------

/** Who may use a Core plugin, as the plugin registry stores it. */
export type CorePluginAuthority =
  | { readonly kind: 'none' }
  | { readonly kind: 'owner' }
  | { readonly kind: 'updateAuthority' }
  | { readonly kind: 'address'; readonly address: Address };

/** The parts of a collection asset the market looks at. */
export interface CoreAssetMarketView {
  owner: Address;
  collection: Address;
  /** Authority of the TransferDelegate plugin; `null` when the asset has none. */
  transferDelegate: CorePluginAuthority | null;
  /** Authority of the FreezeDelegate plugin; `null` when the asset has none. */
  freezeDelegate: CorePluginAuthority | null;
  /** True while a FreezeDelegate plugin holds the asset; Core then refuses every transfer. */
  frozen: boolean;
}

/** `PluginType` values in Core's plugin registry. */
export const CORE_PLUGIN_TYPE = { royalties: 0, freezeDelegate: 1, transferDelegate: 3 } as const;

/**
 * Reads an uncompressed Core asset whose update authority is a collection,
 * with its TransferDelegate and FreezeDelegate plugins. Same layout as
 * `programs/market/src/core_asset.rs`; `undefined` for anything malformed.
 */
export function decodeCoreAssetForMarket(data: Uint8Array): CoreAssetMarketView | undefined {
  let offset = 0;
  const bytes = view(data);
  const need = (length: number): boolean => offset + length <= data.length;
  const u8 = (): number | undefined => (need(1) ? bytes.getUint8(offset++) : undefined);
  const skip = (length: number): boolean => {
    if (!need(length)) return false;
    offset += length;
    return true;
  };
  const skipString = (): boolean => need(4) && skip(4 + bytes.getUint32(offset, true));

  if (u8() !== 1 || !need(32)) return undefined;
  const owner = key(data, offset);
  offset += 32;
  if (u8() !== 2 || !need(32)) return undefined;
  const collection = key(data, offset);
  offset += 32;
  if (!skipString() || !skipString()) return undefined;
  const seq = u8();
  if (seq === 1) {
    if (!skip(8)) return undefined;
  } else if (seq !== 0) {
    return undefined;
  }
  if (offset === data.length) return { owner, collection, transferDelegate: null, freezeDelegate: null, frozen: false };

  // PluginHeaderV1, then the registry it points at.
  if (u8() !== 3 || !need(8)) return undefined;
  const registryOffset = Number(bytes.getBigUint64(offset, true));
  offset = registryOffset;
  if (u8() !== 4 || !need(4)) return undefined;
  const count = bytes.getUint32(offset, true);
  offset += 4;

  let transferDelegate: CorePluginAuthority | null = null;
  let freezeDelegate: CorePluginAuthority | null = null;
  let freezeAt: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const type = u8();
    const tag = u8();
    let authority: CorePluginAuthority;
    if (tag === 0) authority = { kind: 'none' };
    else if (tag === 1) authority = { kind: 'owner' };
    else if (tag === 2) authority = { kind: 'updateAuthority' };
    else if (tag === 3 && need(32)) {
      authority = { kind: 'address', address: key(data, offset) };
      offset += 32;
    } else return undefined;
    if (type === undefined || !need(8)) return undefined;
    const pluginOffset = Number(bytes.getBigUint64(offset, true));
    offset += 8;
    if (type === CORE_PLUGIN_TYPE.transferDelegate && transferDelegate === null) transferDelegate = authority;
    if (type === CORE_PLUGIN_TYPE.freezeDelegate && freezeAt === null) {
      freezeAt = pluginOffset;
      freezeDelegate = authority;
    }
  }
  // The external registry follows; only its length is checked, as in the program.
  if (!need(4)) return undefined;

  // The plugin itself is the borsh `Plugin` enum: its tag, then `FreezeDelegate { frozen: bool }`.
  let frozen = false;
  if (freezeAt !== null) {
    if (freezeAt + 2 > data.length || data[freezeAt] !== CORE_PLUGIN_TYPE.freezeDelegate) return undefined;
    const flag = data[freezeAt + 1];
    if (flag !== 0 && flag !== 1) return undefined;
    frozen = flag === 1;
  }
  return { owner, collection, transferDelegate, freezeDelegate, frozen };
}

export interface OfferOnChain {
  version: number;
  asset: Address;
  buyer: Address;
  /** Held by the offer account on top of its rent. */
  amountLamports: bigint;
  /** Unix seconds of the latest `make_offer`. */
  madeAt: number;
  /** Unix seconds; from then on the offer can no longer be accepted. */
  expiresAt: number;
  bump: number;
}

export function decodeOffer(data: Uint8Array): OfferOnChain | undefined {
  const layout = OFFER_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, OFFER_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  return {
    version: bytes.getUint8(layout.versionOffset),
    asset: key(data, layout.assetOffset),
    buyer: key(data, layout.buyerOffset),
    amountLamports: bytes.getBigUint64(layout.amountOffset, true),
    madeAt: Number(bytes.getBigInt64(layout.madeAtOffset, true)),
    expiresAt: Number(bytes.getBigInt64(layout.expiresAtOffset, true)),
    bump: bytes.getUint8(layout.bumpOffset),
  };
}

// --- addresses -------------------------------------------------------------------

async function derive(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress, seeds });
  return pda;
}

export const marketConfigAddress = (programId: Address): Promise<Address> =>
  derive(programId, [text.encode(MARKET_SEEDS.config)]);

export const listingAddress = (programId: Address, asset: Address): Promise<Address> =>
  derive(programId, [text.encode(MARKET_SEEDS.listing), new Uint8Array(addressBytes.encode(asset))]);

export const auctionAddress = (programId: Address, asset: Address): Promise<Address> =>
  derive(programId, [text.encode(MARKET_SEEDS.auction), new Uint8Array(addressBytes.encode(asset))]);

export const offerAddress = (programId: Address, asset: Address, buyer: Address): Promise<Address> =>
  derive(programId, [text.encode(MARKET_SEEDS.offer), new Uint8Array(addressBytes.encode(asset)), new Uint8Array(addressBytes.encode(buyer))]);

/** The PDA sellers name as their asset's transfer delegate. */
export const marketAuthorityAddress = (programId: Address): Promise<Address> =>
  derive(programId, [text.encode(MARKET_SEEDS.authority)]);

// --- Core plugin instructions ------------------------------------------------------

/** `MplAssetInstruction` variants: their position in the enum. */
export const CORE_INSTRUCTION = {
  addPluginV1: 2,
  updatePluginV1: 6,
  approvePluginAuthorityV1: 8,
  revokePluginAuthorityV1: 10,
} as const;

const AUTHORITY_ADDRESS = 3;
const OPTION_SOME = 1;

/** The two owner-managed plugins the market takes over. */
export type MarketPlugin = 'transferDelegate' | 'freezeDelegate';

interface CorePluginInput {
  asset: Address;
  collection: Address;
  /** Current owner of the asset; signs and pays. */
  owner: Address;
}

/**
 * Accounts shared by Core's plugin instructions: asset, collection, payer,
 * authority, system program, and the log wrapper, which is left out by
 * passing the Core program id in its place.
 */
const corePluginAccounts = ({ asset, collection, owner }: CorePluginInput) => [
  { address: asset, role: AccountRole.WRITABLE },
  { address: collection, role: AccountRole.WRITABLE },
  { address: owner, role: AccountRole.WRITABLE_SIGNER },
  { address: owner, role: AccountRole.READONLY_SIGNER },
  { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
  { address: CORE, role: AccountRole.READONLY },
];

/** The borsh `Plugin` value a new plugin starts with; a FreezeDelegate starts unfrozen. */
const pluginBody = (plugin: MarketPlugin): number[] =>
  plugin === 'freezeDelegate' ? [CORE_PLUGIN_TYPE.freezeDelegate, 0] : [CORE_PLUGIN_TYPE.transferDelegate];

/** `AddPluginV1`: `plugin` with `delegate` as its authority. */
export function coreAddPluginInstruction(input: CorePluginInput & { plugin: MarketPlugin; delegate: Address }): Instruction {
  return {
    programAddress: CORE,
    accounts: corePluginAccounts(input),
    data: Uint8Array.of(
      CORE_INSTRUCTION.addPluginV1,
      ...pluginBody(input.plugin),
      OPTION_SOME,
      AUTHORITY_ADDRESS,
      ...addressBytes.encode(input.delegate),
    ),
  };
}

/** `ApprovePluginAuthorityV1`: hands an existing plugin held by the owner to `delegate`. */
export function coreApprovePluginInstruction(input: CorePluginInput & { plugin: MarketPlugin; delegate: Address }): Instruction {
  return {
    programAddress: CORE,
    accounts: corePluginAccounts(input),
    data: Uint8Array.of(
      CORE_INSTRUCTION.approvePluginAuthorityV1,
      CORE_PLUGIN_TYPE[input.plugin],
      AUTHORITY_ADDRESS,
      ...addressBytes.encode(input.delegate),
    ),
  };
}

/** `RevokePluginAuthorityV1`: hands the plugin back to the owner. */
export function coreRevokePluginInstruction(input: CorePluginInput & { plugin: MarketPlugin }): Instruction {
  return {
    programAddress: CORE,
    accounts: corePluginAccounts(input),
    data: Uint8Array.of(CORE_INSTRUCTION.revokePluginAuthorityV1, CORE_PLUGIN_TYPE[input.plugin]),
  };
}

/** The TransferDelegate variants, kept by name for callers of the fixed-price market. */
export const coreAddTransferDelegateInstruction = (input: CorePluginInput & { delegate: Address }): Instruction =>
  coreAddPluginInstruction({ ...input, plugin: 'transferDelegate' });
export const coreApproveTransferDelegateInstruction = (input: CorePluginInput & { delegate: Address }): Instruction =>
  coreApprovePluginInstruction({ ...input, plugin: 'transferDelegate' });
export const coreRevokeTransferDelegateInstruction = (input: CorePluginInput): Instruction =>
  coreRevokePluginInstruction({ ...input, plugin: 'transferDelegate' });

/**
 * What it takes for `delegate` to hold `plugin`, given its current authority:
 * nothing when it already does, an add when the asset has no such plugin, an
 * approve when the owner holds it, and a revoke before the approve when
 * anyone else does, because Core refuses to re-point a delegated plugin
 * (`CannotRedelegate`).
 */
export function pointPluginInstructions(
  input: CorePluginInput & { plugin: MarketPlugin; delegate: Address; current: CorePluginAuthority | null },
): Instruction[] {
  const { current, delegate } = input;
  if (current === null) return [coreAddPluginInstruction(input)];
  if (current.kind === 'address' && current.address === delegate) return [];
  if (current.kind === 'address') return [coreRevokePluginInstruction(input), coreApprovePluginInstruction(input)];
  return [coreApprovePluginInstruction(input)];
}

// --- market instructions -------------------------------------------------------------

function u64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

const withU64 = (discriminator: Uint8Array, value: bigint): Uint8Array => Uint8Array.from([...discriminator, ...u64Le(value)]);

export interface CreateListingInput {
  programId: Address;
  seller: Address;
  asset: Address;
  priceLamports: bigint;
}

export async function createListingInstruction(input: CreateListingInput): Promise<Instruction> {
  const { programId, seller, asset, priceLamports } = input;
  const [config, listing] = await Promise.all([marketConfigAddress(programId), listingAddress(programId, asset)]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: listing, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.READONLY },
      { address: seller, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: withU64(MARKET_INSTRUCTION_DISCRIMINATORS.createListing, priceLamports),
  };
}

export async function updatePriceInstruction(input: CreateListingInput): Promise<Instruction> {
  const { programId, seller, asset, priceLamports } = input;
  const [config, listing] = await Promise.all([marketConfigAddress(programId), listingAddress(programId, asset)]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: listing, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.READONLY },
      { address: seller, role: AccountRole.READONLY_SIGNER },
    ],
    data: withU64(MARKET_INSTRUCTION_DISCRIMINATORS.updatePrice, priceLamports),
  };
}

export async function cancelListingInstruction(input: { programId: Address; seller: Address; asset: Address }): Promise<Instruction> {
  const listing = await listingAddress(input.programId, input.asset);
  return {
    programAddress: input.programId,
    accounts: [
      { address: listing, role: AccountRole.WRITABLE },
      { address: input.seller, role: AccountRole.WRITABLE_SIGNER },
    ],
    data: Uint8Array.from(MARKET_INSTRUCTION_DISCRIMINATORS.cancelListing),
  };
}

export interface CloseStaleListingInput {
  programId: Address;
  asset: Address;
  /** The seller recorded in the listing; gets the rent back. */
  seller: Address;
  /** Anyone; signs. */
  caller: Address;
}

export async function closeStaleListingInstruction(input: CloseStaleListingInput): Promise<Instruction> {
  const { programId, asset, seller, caller } = input;
  const [config, listing] = await Promise.all([marketConfigAddress(programId), listingAddress(programId, asset)]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: listing, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.READONLY },
      { address: seller, role: AccountRole.WRITABLE },
      { address: caller, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from(MARKET_INSTRUCTION_DISCRIMINATORS.closeStaleListing),
  };
}

export interface BuyInput {
  programId: Address;
  buyer: Address;
  asset: Address;
  seller: Address;
  /** From the market config: the collection and both payout addresses. */
  config: Pick<MarketConfigOnChain, 'collection' | 'royaltyRecipient' | 'feeRecipient'>;
  /** The price the buyer saw. The program refuses the sale if the listing now asks more. */
  maxPriceLamports: bigint;
}

export async function buyInstruction(input: BuyInput): Promise<Instruction> {
  const { programId, buyer, asset, seller, config, maxPriceLamports } = input;
  const [configAddress, listing, authority] = await Promise.all([
    marketConfigAddress(programId),
    listingAddress(programId, asset),
    marketAuthorityAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: configAddress, role: AccountRole.READONLY },
      { address: listing, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.WRITABLE },
      { address: config.collection, role: AccountRole.READONLY },
      { address: seller, role: AccountRole.WRITABLE },
      { address: buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: config.royaltyRecipient, role: AccountRole.WRITABLE },
      { address: config.feeRecipient, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY },
      { address: CORE, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: withU64(MARKET_INSTRUCTION_DISCRIMINATORS.buy, maxPriceLamports),
  };
}

// --- whole actions -------------------------------------------------------------------

export interface ListForSaleInput extends CreateListingInput {
  collection: Address;
  /** The asset's TransferDelegate authority as read from the cluster; `null` when it has no such plugin. */
  transferDelegate: CorePluginAuthority | null;
  /** The seller of a listing a previous owner left on this asset, if any. It is closed first. */
  staleListingSeller?: Address | null;
}

/**
 * Everything one listing needs, in one transaction: closing a previous
 * owner's listing, making the market the transfer delegate (see
 * `pointPluginInstructions`), and `create_listing`. A failure anywhere undoes
 * all of it.
 */
export async function listForSaleInstructions(input: ListForSaleInput): Promise<Instruction[]> {
  const { programId, seller, asset, collection, transferDelegate, staleListingSeller } = input;
  const authority = await marketAuthorityAddress(programId);
  const instructions: Instruction[] = [];
  if (staleListingSeller) {
    instructions.push(await closeStaleListingInstruction({ programId, asset, seller: staleListingSeller, caller: seller }));
  }
  instructions.push(
    ...pointPluginInstructions({
      asset,
      collection,
      owner: seller,
      plugin: 'transferDelegate',
      delegate: authority,
      current: transferDelegate,
    }),
  );
  instructions.push(await createListingInstruction(input));
  return instructions;
}

export interface CancelForSaleInput {
  programId: Address;
  seller: Address;
  asset: Address;
  collection: Address;
  transferDelegate: CorePluginAuthority | null;
}

/** `cancel_listing`, plus revoking the market's delegate when it still holds it. */
export async function cancelSaleInstructions(input: CancelForSaleInput): Promise<Instruction[]> {
  const { programId, seller, asset, collection, transferDelegate } = input;
  const instructions = [await cancelListingInstruction({ programId, seller, asset })];
  const authority = await marketAuthorityAddress(programId);
  if (transferDelegate?.kind === 'address' && transferDelegate.address === authority) {
    instructions.push(coreRevokeTransferDelegateInstruction({ asset, collection, owner: seller }));
  }
  return instructions;
}

// --- auctions ------------------------------------------------------------------------

export interface CreateAuctionInput {
  programId: Address;
  seller: Address;
  asset: Address;
  collection: Address;
  startPriceLamports: bigint;
  durationHours: AuctionDurationHours;
}

export async function createAuctionInstruction(input: CreateAuctionInput): Promise<Instruction> {
  const { programId, seller, asset, collection, startPriceLamports, durationHours } = input;
  const [config, auction, listing, authority] = await Promise.all([
    marketConfigAddress(programId),
    auctionAddress(programId, asset),
    listingAddress(programId, asset),
    marketAuthorityAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: auction, role: AccountRole.WRITABLE },
      { address: listing, role: AccountRole.READONLY },
      { address: asset, role: AccountRole.WRITABLE },
      { address: collection, role: AccountRole.WRITABLE },
      { address: seller, role: AccountRole.WRITABLE_SIGNER },
      { address: authority, role: AccountRole.READONLY },
      { address: CORE, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([...withU64(MARKET_INSTRUCTION_DISCRIMINATORS.createAuction, startPriceLamports), durationHours]),
  };
}

/**
 * Anchor reads an optional account that is absent as the program's own id in
 * its slot, read-only. Used for the previous bidder of a first bid and the
 * winner of an auction nobody bid on.
 */
const optional = (programId: Address, account: Address | null) =>
  account === null ? { address: programId, role: AccountRole.READONLY } : { address: account, role: AccountRole.WRITABLE };

export interface PlaceBidInput {
  programId: Address;
  bidder: Address;
  asset: Address;
  amountLamports: bigint;
  /** The auction's current highest bidder, paid back by this bid; `null` for the first bid. */
  previousBidder: Address | null;
}

export async function placeBidInstruction(input: PlaceBidInput): Promise<Instruction> {
  const { programId, bidder, asset, amountLamports, previousBidder } = input;
  const [config, auction, authority] = await Promise.all([
    marketConfigAddress(programId),
    auctionAddress(programId, asset),
    marketAuthorityAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: auction, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.READONLY },
      { address: bidder, role: AccountRole.WRITABLE_SIGNER },
      optional(programId, previousBidder),
      { address: authority, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: withU64(MARKET_INSTRUCTION_DISCRIMINATORS.placeBid, amountLamports),
  };
}

export async function cancelAuctionInstruction(input: {
  programId: Address;
  seller: Address;
  asset: Address;
  collection: Address;
}): Promise<Instruction> {
  const { programId, seller, asset, collection } = input;
  const [config, auction, authority] = await Promise.all([
    marketConfigAddress(programId),
    auctionAddress(programId, asset),
    marketAuthorityAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: auction, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.WRITABLE },
      { address: collection, role: AccountRole.WRITABLE },
      { address: seller, role: AccountRole.WRITABLE_SIGNER },
      { address: authority, role: AccountRole.READONLY },
      { address: CORE, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from(MARKET_INSTRUCTION_DISCRIMINATORS.cancelAuction),
  };
}

export interface SettleAuctionInput {
  programId: Address;
  /** Anyone; signs and pays the transaction. */
  caller: Address;
  auction: Pick<AuctionOnChain, 'asset' | 'seller' | 'highestBidder'>;
  config: Pick<MarketConfigOnChain, 'collection' | 'royaltyRecipient' | 'feeRecipient'>;
}

export async function settleAuctionInstruction(input: SettleAuctionInput): Promise<Instruction> {
  const { programId, caller, auction, config } = input;
  const [configAddress, auctionKey, authority] = await Promise.all([
    marketConfigAddress(programId),
    auctionAddress(programId, auction.asset),
    marketAuthorityAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: configAddress, role: AccountRole.READONLY },
      { address: auctionKey, role: AccountRole.WRITABLE },
      { address: auction.asset, role: AccountRole.WRITABLE },
      { address: config.collection, role: AccountRole.WRITABLE },
      { address: auction.seller, role: AccountRole.WRITABLE },
      optional(programId, auction.highestBidder),
      { address: config.royaltyRecipient, role: AccountRole.WRITABLE },
      { address: config.feeRecipient, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY },
      { address: CORE, role: AccountRole.READONLY },
      { address: caller, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from(MARKET_INSTRUCTION_DISCRIMINATORS.settleAuction),
  };
}

export interface StartAuctionInput extends CreateAuctionInput {
  /** The seller of a listing a previous owner left on this asset, if any. It is closed first. */
  staleListingSeller?: Address | null;
}

/**
 * Everything one auction needs, in one transaction: closing a previous
 * owner's leftover listing, then `create_auction`, which hands the citizen
 * to the market until the auction is cancelled or finished (D-0092).
 */
export async function startAuctionInstructions(input: StartAuctionInput): Promise<Instruction[]> {
  const { programId, seller, asset, staleListingSeller } = input;
  const instructions: Instruction[] = [];
  if (staleListingSeller) {
    instructions.push(await closeStaleListingInstruction({ programId, asset, seller: staleListingSeller, caller: seller }));
  }
  instructions.push(await createAuctionInstruction(input));
  return instructions;
}

/**
 * `cancel_auction`, which hands the citizen back. An auction from before the
 * market held its citizen thaws it in the seller's wallet instead, and the
 * delegates the market still holds then go back to the seller as well.
 */
export async function cancelAuctionInstructions(input: {
  programId: Address;
  seller: Address;
  asset: Address;
  collection: Address;
  transferDelegate: CorePluginAuthority | null;
  freezeDelegate: CorePluginAuthority | null;
}): Promise<Instruction[]> {
  const { programId, seller, asset, collection, transferDelegate, freezeDelegate } = input;
  const authority = await marketAuthorityAddress(programId);
  const held = (current: CorePluginAuthority | null) => current?.kind === 'address' && current.address === authority;
  const instructions = [await cancelAuctionInstruction({ programId, seller, asset, collection })];
  const core = { asset, collection, owner: seller };
  if (held(freezeDelegate)) instructions.push(coreRevokePluginInstruction({ ...core, plugin: 'freezeDelegate' }));
  if (held(transferDelegate)) instructions.push(coreRevokePluginInstruction({ ...core, plugin: 'transferDelegate' }));
  return instructions;
}

// --- offers ----------------------------------------------------------------------------

export interface MakeOfferInput {
  programId: Address;
  buyer: Address;
  asset: Address;
  amountLamports: bigint;
  days: OfferDays;
}

/** A new offer, or one that replaces the buyer's earlier offer on this citizen and pays it back. */
export async function makeOfferInstruction(input: MakeOfferInput): Promise<Instruction> {
  const { programId, buyer, asset, amountLamports, days } = input;
  const [config, offer, authority] = await Promise.all([
    marketConfigAddress(programId),
    offerAddress(programId, asset, buyer),
    marketAuthorityAddress(programId),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: offer, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.READONLY },
      { address: buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: authority, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([...withU64(MARKET_INSTRUCTION_DISCRIMINATORS.makeOffer, amountLamports), days]),
  };
}

export async function withdrawOfferInstruction(input: { programId: Address; buyer: Address; asset: Address }): Promise<Instruction> {
  const { programId, buyer, asset } = input;
  return {
    programAddress: programId,
    accounts: [
      { address: await offerAddress(programId, asset, buyer), role: AccountRole.WRITABLE },
      { address: buyer, role: AccountRole.WRITABLE_SIGNER },
    ],
    data: Uint8Array.from(MARKET_INSTRUCTION_DISCRIMINATORS.withdrawOffer),
  };
}

/** After its end anyone may close an offer; everything goes back to its buyer. */
export async function closeExpiredOfferInstruction(input: {
  programId: Address;
  buyer: Address;
  asset: Address;
  caller: Address;
}): Promise<Instruction> {
  const { programId, buyer, asset, caller } = input;
  return {
    programAddress: programId,
    accounts: [
      { address: await offerAddress(programId, asset, buyer), role: AccountRole.WRITABLE },
      { address: buyer, role: AccountRole.WRITABLE },
      { address: caller, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from(MARKET_INSTRUCTION_DISCRIMINATORS.closeExpiredOffer),
  };
}

export interface AcceptOfferInput {
  programId: Address;
  /** The citizen's owner; signs the transfer. */
  owner: Address;
  buyer: Address;
  asset: Address;
  /** The amount the owner saw. The program refuses the sale if the offer changed since. */
  amountLamports: bigint;
  /** True when the owner has this citizen listed; the listing closes with the sale. */
  listed: boolean;
  config: Pick<MarketConfigOnChain, 'collection' | 'royaltyRecipient' | 'feeRecipient'>;
}

export async function acceptOfferInstruction(input: AcceptOfferInput): Promise<Instruction> {
  const { programId, owner, buyer, asset, amountLamports, listed, config } = input;
  const [configAddress, offer, listing] = await Promise.all([
    marketConfigAddress(programId),
    offerAddress(programId, asset, buyer),
    listingAddress(programId, asset),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: configAddress, role: AccountRole.READONLY },
      { address: offer, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.WRITABLE },
      { address: config.collection, role: AccountRole.READONLY },
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: buyer, role: AccountRole.WRITABLE },
      optional(programId, listed ? listing : null),
      { address: config.royaltyRecipient, role: AccountRole.WRITABLE },
      { address: config.feeRecipient, role: AccountRole.WRITABLE },
      { address: CORE, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: withU64(MARKET_INSTRUCTION_DISCRIMINATORS.acceptOffer, amountLamports),
  };
}

// --- events ----------------------------------------------------------------------------

/** First 8 bytes of `sha256("event:<Name>")`, the Anchor event discriminators. */
export const MARKET_EVENT_DISCRIMINATORS = {
  Sold: Uint8Array.of(205, 203, 210, 202, 96, 11, 192, 10),
  AuctionSettled: Uint8Array.of(61, 151, 131, 170, 95, 203, 219, 147),
  BidPlaced: Uint8Array.of(135, 53, 176, 83, 193, 69, 108, 61),
  AuctionCreated: Uint8Array.of(133, 190, 194, 65, 172, 0, 70, 178),
  AuctionCancelled: Uint8Array.of(22, 32, 51, 83, 215, 194, 171, 209),
  OfferMade: Uint8Array.of(11, 5, 86, 210, 3, 4, 25, 154),
  OfferWithdrawn: Uint8Array.of(239, 29, 37, 199, 103, 204, 16, 102),
  OfferAccepted: Uint8Array.of(81, 238, 238, 115, 140, 18, 8, 20),
} as const;

/** The events a sale history and its notices are built from (`programs/market/src/events.rs`). */
export type MarketEvent =
  | {
      readonly kind: 'sold';
      readonly asset: Address;
      readonly seller: Address;
      readonly buyer: Address;
      readonly priceLamports: bigint;
      readonly royaltyLamports: bigint;
      readonly feeLamports: bigint;
      readonly sellerLamports: bigint;
    }
  | {
      readonly kind: 'auctionSettled';
      readonly asset: Address;
      readonly seller: Address;
      /** `null` when nobody bid. */
      readonly winner: Address | null;
      readonly priceLamports: bigint;
      readonly royaltyLamports: bigint;
      readonly feeLamports: bigint;
      readonly sellerLamports: bigint;
      /** False when the bid was paid back instead. */
      readonly delivered: boolean;
    }
  | {
      readonly kind: 'bidPlaced';
      readonly asset: Address;
      readonly bidder: Address;
      readonly amountLamports: bigint;
      readonly previousBidder: Address | null;
      readonly refundedLamports: bigint;
      readonly endsAt: number;
    }
  | { readonly kind: 'auctionCreated'; readonly asset: Address; readonly seller: Address; readonly startPriceLamports: bigint; readonly endsAt: number }
  | { readonly kind: 'auctionCancelled'; readonly asset: Address; readonly seller: Address }
  | {
      readonly kind: 'offerMade';
      readonly asset: Address;
      readonly buyer: Address;
      readonly amountLamports: bigint;
      /** Zero for a new offer; otherwise the replaced amount, paid back in the same step. */
      readonly previousAmountLamports: bigint;
      readonly expiresAt: number;
    }
  | {
      readonly kind: 'offerWithdrawn';
      readonly asset: Address;
      readonly buyer: Address;
      readonly amountLamports: bigint;
      /** True when someone closed it after its end. */
      readonly expired: boolean;
    }
  | {
      readonly kind: 'offerAccepted';
      readonly asset: Address;
      readonly seller: Address;
      readonly buyer: Address;
      readonly priceLamports: bigint;
      readonly royaltyLamports: bigint;
      readonly feeLamports: bigint;
      readonly sellerLamports: bigint;
    };

/** One event's borsh bytes, discriminator first. `undefined` for anything else. */
export function decodeMarketEvent(data: Uint8Array): MarketEvent | undefined {
  const bytes = view(data);
  const is = (name: keyof typeof MARKET_EVENT_DISCRIMINATORS, length: number) =>
    data.length === length && startsWith(data, MARKET_EVENT_DISCRIMINATORS[name]);
  const at = (offset: number) => key(data, offset);
  const u64 = (offset: number) => bytes.getBigUint64(offset, true);
  const i64 = (offset: number) => Number(bytes.getBigInt64(offset, true));
  const orNull = (address: Address) => (address === DEFAULT_ADDRESS ? null : address);

  if (is('Sold', 8 + 32 * 3 + 8 * 4)) {
    return { kind: 'sold', asset: at(8), seller: at(40), buyer: at(72), priceLamports: u64(104), royaltyLamports: u64(112), feeLamports: u64(120), sellerLamports: u64(128) };
  }
  if (is('AuctionSettled', 8 + 32 * 3 + 8 * 4 + 1)) {
    const flag = data[136];
    if (flag !== 0 && flag !== 1) return undefined;
    return {
      kind: 'auctionSettled',
      asset: at(8),
      seller: at(40),
      winner: orNull(at(72)),
      priceLamports: u64(104),
      royaltyLamports: u64(112),
      feeLamports: u64(120),
      sellerLamports: u64(128),
      delivered: flag === 1,
    };
  }
  if (is('BidPlaced', 8 + 32 * 2 + 8 + 32 + 8 + 8)) {
    return { kind: 'bidPlaced', asset: at(8), bidder: at(40), amountLamports: u64(72), previousBidder: orNull(at(80)), refundedLamports: u64(112), endsAt: i64(120) };
  }
  if (is('AuctionCreated', 8 + 32 * 2 + 8 + 8)) {
    return { kind: 'auctionCreated', asset: at(8), seller: at(40), startPriceLamports: u64(72), endsAt: i64(80) };
  }
  if (is('AuctionCancelled', 8 + 32 * 2)) return { kind: 'auctionCancelled', asset: at(8), seller: at(40) };
  if (is('OfferMade', 8 + 32 * 2 + 8 * 3)) {
    return { kind: 'offerMade', asset: at(8), buyer: at(40), amountLamports: u64(72), previousAmountLamports: u64(80), expiresAt: i64(88) };
  }
  if (is('OfferWithdrawn', 8 + 32 * 2 + 8 + 1)) {
    const flag = data[80];
    if (flag !== 0 && flag !== 1) return undefined;
    return { kind: 'offerWithdrawn', asset: at(8), buyer: at(40), amountLamports: u64(72), expired: flag === 1 };
  }
  if (is('OfferAccepted', 8 + 32 * 3 + 8 * 4)) {
    return {
      kind: 'offerAccepted',
      asset: at(8),
      seller: at(40),
      buyer: at(72),
      priceLamports: u64(104),
      royaltyLamports: u64(112),
      feeLamports: u64(120),
      sellerLamports: u64(128),
    };
  }
  return undefined;
}

const base64 = getBase64Encoder();

/**
 * The market events in one transaction's logs. Anchor writes each event as
 * `Program data: <base64>`; only lines written while the market program is the
 * one running count, so another program in the same transaction cannot pass
 * its own bytes off as a market event.
 */
export function marketEventsFromLogs(logs: readonly string[], programId: Address): MarketEvent[] {
  const running: string[] = [];
  const events: MarketEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      running.push(invoke[1] as string);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      running.pop();
      continue;
    }
    const payload = /^Program data: (\S+)$/.exec(line);
    if (!payload || running[running.length - 1] !== programId) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(base64.encode(payload[1] as string));
    } catch {
      continue;
    }
    const event = decodeMarketEvent(bytes);
    if (event) events.push(event);
  }
  return events;
}

