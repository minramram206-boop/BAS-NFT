import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ID } from './instructions.js';
import { CORE_PLUGIN_TYPE, marketConfigAddress } from './market.js';

/**
 * What the market's setup script needs and the web app does not: the two
 * admin instructions it sends, and a reader for the collection's Royalties
 * plugin so the config can be checked against it. The program cannot read
 * collection plugins itself (docs/MARKET.md).
 */

const addressBytes = getAddressEncoder();
const addressDecoder = getAddressDecoder();

export const UPGRADEABLE_LOADER_ID = address('BPFLoaderUpgradeab1e11111111111111111111111');

/** Discriminators of the admin instructions, `sha256("global:<name>")[..8]`. */
export const MARKET_ADMIN_DISCRIMINATORS = {
  initializeConfig: Uint8Array.of(208, 127, 21, 1, 194, 190, 196, 70),
  setPaused: Uint8Array.of(91, 60, 125, 192, 176, 225, 166, 218),
} as const;

/** Where the upgradeable loader keeps a program's code and upgrade authority. */
export async function programDataAddress(programId: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: UPGRADEABLE_LOADER_ID,
    seeds: [new Uint8Array(addressBytes.encode(programId))],
  });
  return pda;
}

/** Upgrade authority stored in a ProgramData account; `null` when the program is immutable or the bytes are not one. */
export function decodeUpgradeAuthority(data: Uint8Array): Address | null {
  // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
  if (data.length < 45 || data[0] !== 3 || data[1] !== 0 || data[2] !== 0 || data[3] !== 0) return null;
  return data[12] === 1 ? addressDecoder.decode(data.subarray(13, 45)) : null;
}

export interface InitializeMarketConfigInput {
  programId: Address;
  /** The program's upgrade authority; becomes the admin and pays. */
  admin: Address;
  collection: Address;
  royaltyRecipient: Address;
  feeRecipient: Address;
  royaltyBps: number;
  feeBps: number;
}

export async function initializeMarketConfigInstruction(input: InitializeMarketConfigInput): Promise<Instruction> {
  const { programId, admin, collection, royaltyRecipient, feeRecipient, royaltyBps, feeBps } = input;
  const [config, programData] = await Promise.all([marketConfigAddress(programId), programDataAddress(programId)]);
  const data = new Uint8Array(12);
  data.set(MARKET_ADMIN_DISCRIMINATORS.initializeConfig);
  const view = new DataView(data.buffer);
  view.setUint16(8, royaltyBps, true);
  view.setUint16(10, feeBps, true);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: collection, role: AccountRole.READONLY },
      { address: royaltyRecipient, role: AccountRole.READONLY },
      { address: feeRecipient, role: AccountRole.READONLY },
      { address: programData, role: AccountRole.READONLY },
      { address: admin, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

export async function setMarketPausedInstruction(input: { programId: Address; admin: Address; paused: boolean }): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: [
      { address: await marketConfigAddress(input.programId), role: AccountRole.WRITABLE },
      { address: input.admin, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.of(...MARKET_ADMIN_DISCRIMINATORS.setPaused, input.paused ? 1 : 0),
  };
}

export interface CollectionRoyalties {
  basisPoints: number;
  creators: { address: Address; percentage: number }[];
  /** `none` means other marketplaces may skip the royalty; this market pays it regardless. */
  ruleSet: 'none' | 'allowList' | 'denyList';
}

/**
 * The Royalties plugin of a Core `CollectionV1`: `null` when the collection
 * has none, `undefined` when the bytes are not a collection.
 */
export function decodeCollectionRoyalties(data: Uint8Array): CollectionRoyalties | null | undefined {
  const bytes = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const need = (length: number): boolean => offset + length <= data.length;
  const skipString = (): boolean => {
    if (!need(4)) return false;
    const end = offset + 4 + bytes.getUint32(offset, true);
    if (end > data.length) return false;
    offset = end;
    return true;
  };

  // CollectionV1: key = 5, update authority, name, uri, num_minted: u32, current_size: u32.
  if (data[0] !== 5 || !need(33)) return undefined;
  offset = 33;
  if (!skipString() || !skipString() || !need(8)) return undefined;
  offset += 8;
  if (offset === data.length) return null;

  if (data[offset] !== 3 || !need(9)) return undefined;
  offset = Number(bytes.getBigUint64(offset + 1, true));
  if (data[offset] !== 4 || !need(5)) return undefined;
  const count = bytes.getUint32(offset + 1, true);
  offset += 5;
  let royaltiesAt: number | null = null;
  for (let index = 0; index < count; index += 1) {
    if (!need(2)) return undefined;
    const type = data[offset] as number;
    const authority = data[offset + 1];
    offset += 2;
    if (authority === 3) offset += 32;
    else if (authority === undefined || authority > 3) return undefined;
    if (!need(8)) return undefined;
    if (type === CORE_PLUGIN_TYPE.royalties && royaltiesAt === null) royaltiesAt = Number(bytes.getBigUint64(offset, true));
    offset += 8;
  }
  if (royaltiesAt === null) return null;

  // Plugin::Royalties(Royalties { basis_points: u16, creators: Vec<Creator>, rule_set: RuleSet })
  offset = royaltiesAt;
  if (data[offset] !== CORE_PLUGIN_TYPE.royalties || !need(7)) return undefined;
  const basisPoints = bytes.getUint16(offset + 1, true);
  const creatorCount = bytes.getUint32(offset + 3, true);
  offset += 7;
  const creators: CollectionRoyalties['creators'] = [];
  for (let index = 0; index < creatorCount; index += 1) {
    if (!need(33)) return undefined;
    creators.push({ address: addressDecoder.decode(data.subarray(offset, offset + 32)), percentage: data[offset + 32] as number });
    offset += 33;
  }
  const rule = data[offset];
  const ruleSet = rule === 0 ? 'none' : rule === 1 ? 'allowList' : rule === 2 ? 'denyList' : undefined;
  if (!ruleSet) return undefined;
  return { basisPoints, creators, ruleSet };
}
