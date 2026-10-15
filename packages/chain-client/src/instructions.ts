import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';
import { CORE_CANDY_GUARD_PROGRAM_ID, PROGRAM_SEEDS } from './constants.js';
import type { StatType } from './types.js';

/**
 * Instruction builders and addresses of the District program.
 *
 * They return plain `@solana/kit` instructions, so the web app can wrap them in
 * a transaction message and a wallet can sign it. The account order and the
 * writable flags mirror the `Accounts` structs in `programs/district/src/instructions`;
 * `test/instructions.test.ts` reads those sources and fails when they drift.
 */

export const SYSTEM_PROGRAM_ID = address('11111111111111111111111111111111');
export const TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Anchor discriminators: the first 8 bytes of `sha256("global:<instruction>")`. */
export const INSTRUCTION_DISCRIMINATORS = {
  upgradeScore: Uint8Array.of(211, 176, 172, 91, 96, 248, 58, 1),
  claimTrainingCredit: Uint8Array.of(155, 156, 56, 247, 20, 221, 215, 145),
  registerCitizen: Uint8Array.of(241, 250, 3, 236, 214, 25, 141, 170),
} as const;

/** Stat index the program expects (`CitizenStat`). */
export const STAT_INDEX: Readonly<Record<StatType, number>> = { intelligence: 0, alignment: 1, compute: 2 };

const text = new TextEncoder();
const addressBytes = getAddressEncoder();

function u64Le(value: bigint | number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

async function derive(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress, seeds });
  return pda;
}

export const configAddress = (programId: Address): Promise<Address> =>
  derive(programId, [text.encode(PROGRAM_SEEDS.districtConfig)]);

export const citizenStateAddress = (programId: Address, asset: Address): Promise<Address> =>
  derive(programId, [text.encode(PROGRAM_SEEDS.citizen), new Uint8Array(addressBytes.encode(asset))]);

export const approvedTemplateAddress = (programId: Address, templateId: number): Promise<Address> => {
  const id = new Uint8Array(4);
  new DataView(id.buffer).setUint32(0, templateId, true);
  return derive(programId, [text.encode(PROGRAM_SEEDS.approvedTemplate), id]);
};

export const claimReceiptAddress = (
  programId: Address,
  asset: Address,
  missionChainId: number | bigint,
  nonce: number | bigint,
): Promise<Address> =>
  derive(programId, [
    text.encode(PROGRAM_SEEDS.claim),
    new Uint8Array(addressBytes.encode(asset)),
    u64Le(missionChainId),
    u64Le(nonce),
  ]);

/** Associated token account of `owner` for `mint`, under `tokenProgram`. */
export const associatedTokenAddress = (owner: Address, mint: Address, tokenProgram: Address): Promise<Address> =>
  derive(ASSOCIATED_TOKEN_PROGRAM_ID, [
    new Uint8Array(addressBytes.encode(owner)),
    new Uint8Array(addressBytes.encode(tokenProgram)),
    new Uint8Array(addressBytes.encode(mint)),
  ]);

export interface UpgradeScoreInput {
  programId: Address;
  /** Current holder of the citizen asset; signs and pays the burn. */
  owner: Address;
  asset: Address;
  utilityMint: Address;
  /** SPL Token or Token-2022, whichever owns `utilityMint`. */
  tokenProgram: Address;
  stat: StatType;
}

/** `upgrade_score`: burns the training cost, spends one credit and raises the stat by one. */
export async function upgradeScoreInstruction(input: UpgradeScoreInput): Promise<Instruction> {
  const { programId, owner, asset, utilityMint, tokenProgram, stat } = input;
  const [config, citizenState, userTokenAccount] = await Promise.all([
    configAddress(programId),
    citizenStateAddress(programId, asset),
    associatedTokenAddress(owner, utilityMint, tokenProgram),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: asset, role: AccountRole.READONLY },
      { address: citizenState, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
      { address: utilityMint, role: AccountRole.WRITABLE },
      { address: userTokenAccount, role: AccountRole.WRITABLE },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: Uint8Array.of(...INSTRUCTION_DISCRIMINATORS.upgradeScore, STAT_INDEX[stat]),
  };
}

export interface RegisterCitizenInput {
  programId: Address;
  /** Current holder of the asset; signs and pays the rent of the citizen record. */
  owner: Address;
  asset: Address;
  /** `approvedTemplateId` of the cluster manifest. */
  approvedTemplateId: number;
}

/**
 * `register_citizen`: turns an official Core asset into a citizen. The mint
 * puts it right after the Candy Machine instruction, so a failed registration
 * undoes the mint (SPEC §6.3).
 */
export async function registerCitizenInstruction(input: RegisterCitizenInput): Promise<Instruction> {
  const { programId, owner, asset, approvedTemplateId } = input;
  const [config, approvedTemplate, citizenState] = await Promise.all([
    configAddress(programId),
    approvedTemplateAddress(programId, approvedTemplateId),
    citizenStateAddress(programId, asset),
  ]);
  return {
    programAddress: programId,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: asset, role: AccountRole.READONLY },
      { address: approvedTemplate, role: AccountRole.READONLY },
      { address: citizenState, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from(INSTRUCTION_DISCRIMINATORS.registerCitizen),
  };
}

const guardProgram = address(CORE_CANDY_GUARD_PROGRAM_ID);

/** The Candy Guard that wraps `candyMachine`: a PDA of the guard program based on the machine. */
export const candyGuardAddress = (candyMachine: Address): Promise<Address> =>
  derive(guardProgram, [text.encode('candy_guard'), new Uint8Array(addressBytes.encode(candyMachine))]);

export interface MintCounterSeeds {
  /** The `mintLimit` guard id from the guard settings. */
  id: number;
  /** The wallet that mints. */
  user: Address;
  candyMachine: Address;
  candyGuard: Address;
}

/** Where the `mintLimit` guard counts the mints of one wallet. */
export const mintCounterAddress = (seeds: MintCounterSeeds): Promise<Address> =>
  derive(guardProgram, [
    text.encode('mint_limit'),
    Uint8Array.of(seeds.id),
    new Uint8Array(addressBytes.encode(seeds.user)),
    new Uint8Array(addressBytes.encode(seeds.candyGuard)),
    new Uint8Array(addressBytes.encode(seeds.candyMachine)),
  ]);
