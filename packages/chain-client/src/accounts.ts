import { getAddressDecoder, type Address } from '@solana/kit';
import { CANDY_MACHINE_LAYOUT, CORE_ASSET_LAYOUT, ROLE_COUNT } from './constants.js';
import type { CandyMachineOnChain, CitizenStateOnChain, RoleIndex } from './types.js';

/**
 * Decoders for the accounts the web app reads: the district program's
 * `CitizenState`, a Metaplex Core asset, a Core Candy Machine, its per-wallet
 * mint counter and an SPL token account. They take
 * raw account bytes and return `undefined` for anything that is not the
 * account asked for, so a stray account can never pass as a citizen.
 */

const addressDecoder = getAddressDecoder();

/** First 8 bytes of `sha256("account:CitizenState")`, the Anchor account discriminator. */
export const CITIZEN_STATE_DISCRIMINATOR = Uint8Array.of(72, 200, 198, 39, 112, 43, 51, 122);

/** Byte offsets of `CitizenState` (`programs/district/src/state/citizen.rs`). */
export const CITIZEN_STATE_LAYOUT = {
  discriminatorLength: 8,
  versionOffset: 8,
  bumpOffset: 9,
  citizenIdOffset: 10,
  assetOffset: 14,
  roleOffset: 46,
  intelligenceOffset: 47,
  alignmentOffset: 48,
  computeOffset: 49,
  insightCreditsOffset: 50,
  bondCreditsOffset: 52,
  craftCreditsOffset: 54,
  length: 56,
} as const;

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  return data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte);
}

/** Reads a `CitizenState` account, or `undefined` when the bytes are not one. */
export function decodeCitizenState(data: Uint8Array): CitizenStateOnChain | undefined {
  const layout = CITIZEN_STATE_LAYOUT;
  if (data.length !== layout.length || !startsWith(data, CITIZEN_STATE_DISCRIMINATOR)) return undefined;
  const bytes = view(data);
  const role = bytes.getUint8(layout.roleOffset);
  if (role >= ROLE_COUNT) return undefined;
  return {
    version: bytes.getUint8(layout.versionOffset),
    bump: bytes.getUint8(layout.bumpOffset),
    citizenId: bytes.getUint32(layout.citizenIdOffset, true),
    asset: addressDecoder.decode(data.subarray(layout.assetOffset, layout.assetOffset + 32)),
    role: role as RoleIndex,
    intelligence: bytes.getUint8(layout.intelligenceOffset),
    alignment: bytes.getUint8(layout.alignmentOffset),
    compute: bytes.getUint8(layout.computeOffset),
    insightTrainingCredits: bytes.getUint16(layout.insightCreditsOffset, true),
    bondTrainingCredits: bytes.getUint16(layout.bondCreditsOffset, true),
    craftTrainingCredits: bytes.getUint16(layout.craftCreditsOffset, true),
  };
}

/** A Core asset that belongs to a collection. */
export interface CoreAssetOnChain {
  owner: Address;
  collection: Address;
  name: string;
  uri: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Reads a borsh `String` (u32 length, then bytes) at `offset`. */
function readString(data: Uint8Array, offset: number): { value: string; next: number } | undefined {
  if (offset + 4 > data.length) return undefined;
  const length = view(data).getUint32(offset, true);
  const end = offset + 4 + length;
  if (end > data.length) return undefined;
  try {
    return { value: utf8.decode(data.subarray(offset + 4, end)), next: end };
  } catch {
    return undefined;
  }
}

/**
 * Reads an `AssetV1` whose update authority is a collection, the shape the
 * district program requires (`mpl_core.rs`). Anything else is `undefined`.
 */
export function decodeCoreAsset(data: Uint8Array): CoreAssetOnChain | undefined {
  const layout = CORE_ASSET_LAYOUT;
  if (data.length < layout.minPrefixLength) return undefined;
  if (data[0] !== layout.keyAssetV1 || data[layout.updateAuthorityTagOffset] !== layout.updateAuthorityCollection) {
    return undefined;
  }
  const name = readString(data, layout.minPrefixLength);
  const uri = name ? readString(data, name.next) : undefined;
  if (!name || !uri) return undefined;
  return {
    owner: addressDecoder.decode(data.subarray(layout.ownerOffset, layout.ownerOffset + 32)),
    collection: addressDecoder.decode(data.subarray(layout.collectionOffset, layout.collectionOffset + 32)),
    name: name.value,
    uri: uri.value,
  };
}

/**
 * Serial number in a metadata URI `<prefix><serial>-<role>.json` (D-0022), or
 * `undefined` when the last path part does not follow that shape.
 */
export function serialFromMetadataUri(uri: string): number | undefined {
  const file = uri.split('?')[0]?.split('/').pop() ?? '';
  const match = /^(\d+)-[a-z]+\.json$/.exec(file);
  if (!match) return undefined;
  const serial = Number(match[1]);
  return Number.isSafeInteger(serial) && serial > 0 ? serial : undefined;
}

/** SPL token account layout: mint at 0, owner at 32, amount (u64) at 64; Token-2022 starts the same way. */
export const TOKEN_ACCOUNT_LAYOUT = { mintOffset: 0, ownerOffset: 32, amountOffset: 64, minLength: 72 } as const;

/** Balance of a token account in atoms, or `undefined` for a short or foreign account. */
export function decodeTokenAccountAmount(data: Uint8Array, mint: Address, owner: Address): bigint | undefined {
  const layout = TOKEN_ACCOUNT_LAYOUT;
  if (data.length < layout.minLength) return undefined;
  if (addressDecoder.decode(data.subarray(layout.mintOffset, layout.mintOffset + 32)) !== mint) return undefined;
  if (addressDecoder.decode(data.subarray(layout.ownerOffset, layout.ownerOffset + 32)) !== owner) return undefined;
  return view(data).getBigUint64(layout.amountOffset, true);
}

/**
 * Reads the supply side of a Core `CandyMachine`: how many items it holds and
 * how many it has handed out. `undefined` when the bytes are not one.
 */
export function decodeCandyMachine(data: Uint8Array): CandyMachineOnChain | undefined {
  const layout = CANDY_MACHINE_LAYOUT;
  if (data.length < layout.minLength || !startsWith(data, layout.discriminator)) return undefined;
  const bytes = view(data);
  const itemsRedeemed = bytes.getBigUint64(layout.itemsRedeemedOffset, true);
  const itemsAvailable = bytes.getBigUint64(layout.itemsAvailableOffset, true);
  if (itemsRedeemed > BigInt(Number.MAX_SAFE_INTEGER) || itemsAvailable > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return {
    authority: addressDecoder.decode(data.subarray(layout.authorityOffset, layout.authorityOffset + 32)),
    mintAuthority: addressDecoder.decode(data.subarray(layout.mintAuthorityOffset, layout.mintAuthorityOffset + 32)),
    collection: addressDecoder.decode(data.subarray(layout.collectionOffset, layout.collectionOffset + 32)),
    itemsRedeemed: Number(itemsRedeemed),
    itemsAvailable: Number(itemsAvailable),
  };
}

/**
 * Reads a Candy Guard `mintLimit` counter: how many mints the wallet has made
 * under that limit. The account is a bare `u16`, with no discriminator.
 */
export function decodeMintCounter(data: Uint8Array): number | undefined {
  return data.length < 2 ? undefined : view(data).getUint16(0, true);
}
