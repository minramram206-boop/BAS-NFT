#!/usr/bin/env node
/**
 * Sends devnet test tokens from the deployer to a player wallet, so the
 * wallet can try training (which burns the utility token).
 *
 * Usage (from the repository root):
 *   node scripts/devnet/send-tokens.mjs <wallet address> [amount]
 *                                       [--keypair .keys/devnet-deployer.json]
 *                                       [--config config/devnet.json] [--rpc <url>]
 *
 * The amount is in whole tokens and defaults to 1000. The recipient's token
 * account is created when it does not exist yet, paid by the deployer.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  Keypair,
  PublicKey,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  associatedTokenAddress,
  createRpc,
  u64,
  u8,
} from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

// Positional arguments are whatever is not a flag or a flag's value.
const flagged = new Set();
process.argv.forEach((arg, index) => {
  if (arg.startsWith('--')) {
    flagged.add(index);
    flagged.add(index + 1);
  }
});
const positional = process.argv.slice(2).filter((_, index) => !flagged.has(index + 2));
const [recipientText, amountText = '1000'] = positional;

if (!recipientText) {
  console.error('Usage: node scripts/devnet/send-tokens.mjs <wallet address> [amount]');
  process.exit(1);
}
if (!/^\d+$/.test(amountText) || BigInt(amountText) === 0n) {
  console.error(`Amount must be a whole number of tokens, got "${amountText}".`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(resolve(repoRoot, option('config', 'config/devnet.json')), 'utf8'));
const keypairPath = resolve(repoRoot, option('keypair', '.keys/devnet-deployer.json'));
if (!existsSync(keypairPath)) {
  console.error(`Deployer keypair not found: ${keypairPath}`);
  process.exit(1);
}

const deployer = Keypair.fromFile(keypairPath);
const recipient = new PublicKey(recipientText);
const mint = new PublicKey(config.utilityTokenMint);
const rpc = createRpc(option('rpc', process.env.NEXT_PUBLIC_SOLANA_RPC_URL || config.rpcUrl));
const atoms = BigInt(amountText) * 10n ** BigInt(config.tokenDecimals);

if (!(await rpc.getAccount(mint))) {
  console.error(`The utility token mint ${mint} does not exist on this cluster. Run pnpm devnet:setup first.`);
  process.exit(1);
}

const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const source = associatedTokenAddress(deployer.publicKey, mint);
const target = associatedTokenAddress(recipient, mint);

await rpc.send(
  [
    {
      // CreateIdempotent: a no-op when the recipient already has the account.
      programId: ASSOCIATED_TOKEN_PROGRAM,
      keys: [
        meta(deployer.publicKey, true, true),
        meta(target, false, true),
        meta(recipient, false, false),
        meta(mint, false, false),
        meta(SYSTEM_PROGRAM, false, false),
        meta(TOKEN_2022_PROGRAM, false, false),
      ],
      data: u8(1),
    },
    {
      // TransferChecked: amount, decimals
      programId: TOKEN_2022_PROGRAM,
      keys: [meta(source, false, true), meta(mint, false, false), meta(target, false, true), meta(deployer.publicKey, true, false)],
      data: Buffer.concat([u8(12), u64(atoms), u8(config.tokenDecimals)]),
    },
  ],
  [deployer],
);

console.log(`Sent ${amountText} tokens (${mint}) to ${recipient}.`);
process.exit(0);
