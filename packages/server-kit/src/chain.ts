import {
  CORE_ASSET_LAYOUT,
  MPL_CORE_PROGRAM_ID,
  PROGRAM_SEEDS,
  ROLE_COUNT,
  decodeCoreAsset,
  serialFromMetadataUri,
} from '@bas/chain-client';
import { Connection, PublicKey } from '@solana/web3.js';

export interface StatScores {
  readonly intelligence: number;
  readonly alignment: number;
  readonly compute: number;
}

/** Byte offsets of `CitizenState` (`programs/district/src/state/citizen.rs`), after the 8-byte discriminator. */
export const CITIZEN_STATE_LAYOUT = {
  discriminatorLength: 8,
  citizenIdOffset: 10,
  assetOffset: 14,
  roleOffset: 46,
  intelligenceOffset: 47,
  alignmentOffset: 48,
  computeOffset: 49,
  length: 8 + 1 + 1 + 4 + 32 + 1 + 1 + 1 + 1 + 2 + 2 + 2,
} as const;

export interface CitizenOnChain {
  readonly citizenId: number;
  readonly role: number;
  readonly scores: StatScores;
}

/** Reads a `CitizenState` account for `asset`, or `undefined` when the bytes are not one. */
export function parseCitizenState(data: Uint8Array, asset: PublicKey): CitizenOnChain | undefined {
  const layout = CITIZEN_STATE_LAYOUT;
  if (data.length < layout.length) return undefined;
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!view.subarray(layout.assetOffset, layout.assetOffset + 32).equals(asset.toBuffer())) return undefined;
  const role = view.readUInt8(layout.roleOffset);
  if (role >= ROLE_COUNT) return undefined;
  return {
    citizenId: view.readUInt32LE(layout.citizenIdOffset),
    role,
    scores: {
      intelligence: view.readUInt8(layout.intelligenceOffset),
      alignment: view.readUInt8(layout.alignmentOffset),
      compute: view.readUInt8(layout.computeOffset),
    },
  };
}

/** Owner of an uncompressed Core asset inside `collection`, or `undefined`. */
export function parseCoreAssetOwner(data: Uint8Array, collection: PublicKey): PublicKey | undefined {
  const layout = CORE_ASSET_LAYOUT;
  if (data.length < layout.minPrefixLength) return undefined;
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (view.readUInt8(0) !== layout.keyAssetV1) return undefined;
  if (view.readUInt8(layout.updateAuthorityTagOffset) !== layout.updateAuthorityCollection) return undefined;
  const holder = view.subarray(layout.collectionOffset, layout.collectionOffset + 32);
  if (!holder.equals(collection.toBuffer())) return undefined;
  return new PublicKey(view.subarray(layout.ownerOffset, layout.ownerOffset + 32));
}

export function configAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(PROGRAM_SEEDS.districtConfig)], programId)[0];
}

export function citizenAddress(programId: PublicKey, asset: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(PROGRAM_SEEDS.citizen), asset.toBuffer()], programId)[0];
}

/** What a server needs to know about an asset: who holds it and which citizen it is. */
export interface AssetReader {
  /** Current holder of an official citizen asset, or `null` when it is not one. */
  assetOwner(asset: string): Promise<string | null>;
  /** Registered citizen state of the asset, or `null` before `register_citizen`. */
  citizen(asset: string): Promise<CitizenOnChain | null>;
}

/** What the metadata of a citizen asset says about it. */
export interface AssetInfo {
  readonly owner: string;
  /**
   * The roster number in the metadata file name (`<serial>-<role>.json`, D-0022),
   * which is what names a citizen. It is not `CitizenOnChain.citizenId`, which
   * only counts registrations. `null` when the file name does not follow the rule.
   */
  readonly serial: number | null;
}

/** What a server that talks as a citizen needs: the asset's holder and roster number, and its registered state. */
export interface CitizenAssets {
  /** `null` when the asset is not an official citizen of the collection. */
  assetInfo(asset: string): Promise<AssetInfo | null>;
  citizen(asset: string): Promise<CitizenOnChain | null>;
}

export interface ChainAddresses {
  readonly programId: PublicKey;
  readonly collection: PublicKey;
}

/** Reads assets over JSON-RPC. */
export class RpcAssetReader implements AssetReader, CitizenAssets {
  protected readonly connection: Connection;
  protected readonly addresses: ChainAddresses;

  constructor(rpcUrl: string, addresses: ChainAddresses) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.addresses = addresses;
  }

  async assetOwner(asset: string): Promise<string | null> {
    const key = new PublicKey(asset);
    const info = await this.connection.getAccountInfo(key);
    if (!info || !info.owner.equals(new PublicKey(MPL_CORE_PROGRAM_ID))) return null;
    return parseCoreAssetOwner(info.data, this.addresses.collection)?.toBase58() ?? null;
  }

  async assetInfo(asset: string): Promise<AssetInfo | null> {
    const info = await this.connection.getAccountInfo(new PublicKey(asset));
    if (!info || !info.owner.equals(new PublicKey(MPL_CORE_PROGRAM_ID))) return null;
    const decoded = decodeCoreAsset(info.data);
    if (!decoded || decoded.collection !== this.addresses.collection.toBase58()) return null;
    return { owner: decoded.owner, serial: serialFromMetadataUri(decoded.uri) ?? null };
  }

  async citizen(asset: string): Promise<CitizenOnChain | null> {
    const key = new PublicKey(asset);
    const info = await this.connection.getAccountInfo(citizenAddress(this.addresses.programId, key));
    if (!info || !info.owner.equals(this.addresses.programId)) return null;
    return parseCitizenState(info.data, key) ?? null;
  }
}
