import { isSignerRole, isWritableRole, type Instruction } from '@solana/kit';
import { publicKey, type Instruction as UmiInstruction } from '@metaplex-foundation/umi';

/**
 * The only place an `@solana/kit` instruction becomes a Umi one. The District
 * program's builders in `@bas/chain-client` speak Kit; the Candy Machine SDK
 * speaks Umi, and a mint transaction holds both (TECH_STACK §4.3).
 */
export function toUmiInstruction(instruction: Instruction): UmiInstruction {
  return {
    programId: publicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: publicKey(account.address),
      isSigner: isSignerRole(account.role),
      isWritable: isWritableRole(account.role),
    })),
    data: Uint8Array.from(instruction.data ?? []),
  };
}
