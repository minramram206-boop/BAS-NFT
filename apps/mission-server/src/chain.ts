import { createHash } from 'node:crypto';
import { PROGRAM_SEEDS } from '@bas/chain-client';
import { type AssetReader, RpcAssetReader, citizenAddress, configAddress } from '@bas/server-kit';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { StatName } from './catalog.js';

export {
  CITIZEN_STATE_LAYOUT,
  type ChainAddresses,
  type CitizenOnChain,
  citizenAddress,
  configAddress,
  parseCitizenState,
  parseCoreAssetOwner,
} from '@bas/server-kit';

/** What the mission server reads from the chain. */
export interface ChainReader extends AssetReader {
  /** True once the claim receipt of `(asset, missionChainId, nonce)` exists. */
  claimReceiptExists(asset: string, missionChainId: number, nonce: number): Promise<boolean>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

function u64Bytes(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

export function claimReceiptAddress(
  programId: PublicKey,
  asset: PublicKey,
  missionChainId: number,
  nonce: number,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PROGRAM_SEEDS.claim), asset.toBuffer(), u64Bytes(missionChainId), u64Bytes(nonce)],
    programId,
  )[0];
}

/** Reads the chain over JSON-RPC. */
export class RpcChainReader extends RpcAssetReader implements ChainReader {
  async claimReceiptExists(asset: string, missionChainId: number, nonce: number): Promise<boolean> {
    const address = claimReceiptAddress(this.addresses.programId, new PublicKey(asset), missionChainId, nonce);
    const info = await this.connection.getAccountInfo(address);
    return info !== null && info.owner.equals(this.addresses.programId) && info.data.length > 0;
  }

  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.connection.getLatestBlockhash('confirmed');
  }
}

export const STAT_INDEX: Readonly<Record<StatName, number>> = { intelligence: 0, alignment: 1, compute: 2 };

export interface ClaimArgs {
  readonly stat: StatName;
  readonly missionChainId: number;
  readonly seasonId: number;
  readonly nonce: number;
  /** Unix seconds. */
  readonly expiresAt: number;
}

/** Anchor instruction discriminator: the first 8 bytes of `sha256("global:<name>")`. */
export function instructionDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** Borsh bytes of `MissionClaimArgs` after the discriminator. */
export function encodeClaimArgs(args: ClaimArgs): Buffer {
  const bytes = Buffer.alloc(1 + 8 + 4 + 8 + 8);
  bytes.writeUInt8(STAT_INDEX[args.stat], 0);
  bytes.writeBigUInt64LE(BigInt(args.missionChainId), 1);
  bytes.writeUInt32LE(args.seasonId, 9);
  bytes.writeBigUInt64LE(BigInt(args.nonce), 13);
  bytes.writeBigInt64LE(BigInt(args.expiresAt), 21);
  return bytes;
}

export interface ClaimTransactionInput {
  readonly programId: PublicKey;
  readonly asset: PublicKey;
  readonly owner: PublicKey;
  readonly authority: Keypair;
  readonly args: ClaimArgs;
  readonly blockhash: string;
}

/**
 * The `claim_training_credit` transaction, paid for and later signed by the
 * owner, already signed by the mission authority. The program binds the
 * authority's signature to every account and argument in it, so the owner
 * cannot change anything after this point.
 */
export function buildClaimTransaction(input: ClaimTransactionInput): Transaction {
  const { programId, asset, owner, authority, args } = input;
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: citizenAddress(programId, asset), isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      {
        pubkey: claimReceiptAddress(programId, asset, args.missionChainId, args.nonce),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([instructionDiscriminator('claim_training_credit'), encodeClaimArgs(args)]),
  });
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: input.blockhash }).add(instruction);
  transaction.partialSign(authority);
  return transaction;
}
