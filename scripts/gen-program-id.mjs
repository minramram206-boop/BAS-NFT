#!/usr/bin/env node
/**
 * One-off maintenance script: repair the placeholder addresses.
 *
 * `declare_id!` parses the program id at compile time and `Pubkey::from_str`
 * requires 32 bytes of base58, so the previous 42 character placeholder made
 * `cargo check` fail. This script generates a real ed25519 program keypair and
 * well-formed placeholder mints, then reports the values to write into
 * `config/*.json`, `programs/Anchor.toml` and `programs/district/src/lib.rs`.
 *
 * Usage: node scripts/gen-program-id.mjs [--force]
 *
 * It refuses to overwrite an existing keypair, because a second run would
 * generate a program id that no longer matches declare_id!, Anchor.toml and
 * config/*.json. Pass --force only if you intend to update all four copies.
 */

import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let encoded = '';
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = ALPHABET[0] + encoded;
  }
  return encoded;
}

/** Raw 32 byte ed25519 public key from a DER SubjectPublicKeyInfo blob. */
function rawPublicKey(der) {
  return new Uint8Array(der.subarray(der.length - 32));
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicRaw = rawPublicKey(publicKey.export({ format: 'der', type: 'spki' }));
const privatePkcs8 = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' }));
const privateRaw = privatePkcs8.slice(-32);

const programId = base58Encode(publicRaw);

// solana-keygen format: 64 bytes = private seed ++ public key
const keypair = [...privateRaw, ...publicRaw];
if (keypair.length !== 64) {
  throw new Error(`expected a 64 byte keypair, produced ${keypair.length}`);
}

const keypairPath = join(repoRoot, 'programs/district/keypair.json');
if (existsSync(keypairPath) && !process.argv.includes('--force')) {
  console.error(`${keypairPath.replace(repoRoot + '/', '')} already exists.`);
  console.error('Refusing to generate a program id that would disagree with declare_id!,');
  console.error('programs/Anchor.toml and config/*.json. Re-run with --force if you intend');
  console.error('to update all four copies, then let `pnpm test` verify they still match.');
  process.exit(1);
}
await mkdir(dirname(keypairPath), { recursive: true });
await writeFile(keypairPath, `${JSON.stringify(keypair)}\n`, 'utf8');

// A mint placeholder only has to be well-formed base58 of 32 bytes; it is
// replaced by the real mint when the token is deployed.
const placeholderMint = base58Encode(
  new Uint8Array([
    0x0b, 0xa5, 0x1d, 0xe0, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  ]),
);

console.log('program keypair :', keypairPath.replace(repoRoot + '/', ''));
console.log('programId       :', programId, `(${programId.length} chars)`);
console.log('placeholderMint :', placeholderMint, `(${placeholderMint.length} chars)`);
