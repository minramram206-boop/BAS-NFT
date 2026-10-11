/**
 * The small slice of Solana the devnet setup needs, on Node built-ins only:
 * base58, keypair files, PDAs, legacy transactions and JSON-RPC.
 *
 * Kept dependency free on purpose. The setup runs once per cluster from the
 * owner's machine, and pulling a client SDK into the repository for that
 * would pin a second Solana stack next to the one the web app will use.
 */

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function decodeBase58(text) {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`invalid base58 character in ${text}`);
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A 32 byte public key, printable as base58. */
export class PublicKey {
  constructor(value) {
    this.bytes = typeof value === 'string' ? decodeBase58(value) : Uint8Array.from(value);
    if (this.bytes.length !== 32) throw new Error(`public key must be 32 bytes, got ${this.bytes.length}`);
  }

  toString() {
    return encodeBase58(this.bytes);
  }

  equals(other) {
    return this.toString() === other.toString();
  }
}

export const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const MPL_CORE_PROGRAM = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** A signer built from a 32 byte ed25519 seed. */
export class Keypair {
  constructor(seed) {
    this.privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
      format: 'der',
      type: 'pkcs8',
    });
    const spki = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' });
    this.publicKey = new PublicKey(spki.subarray(spki.length - 32));
    this.seed = Uint8Array.from(seed);
  }

  static generate() {
    return new Keypair(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  }

  /** A `solana-keygen` JSON file: 64 numbers, seed then public key. */
  static fromFile(path) {
    const bytes = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`${path} is not a solana-keygen keypair file`);
    const keypair = new Keypair(bytes.slice(0, 32));
    if (encodeBase58(Uint8Array.from(bytes.slice(32))) !== keypair.publicKey.toString()) {
      throw new Error(`${path}: the public key does not match the secret key`);
    }
    return keypair;
  }

  toFileContent() {
    return `${JSON.stringify([...this.seed, ...this.publicKey.bytes])}\n`;
  }

  sign(message) {
    return new Uint8Array(sign(null, message, this.privateKey));
  }
}

// --- program derived addresses -------------------------------------------------

const P = 2n ** 255n - 19n;
const D = (-121665n * modInverse(121666n)) % P;

function mod(value) {
  const result = value % P;
  return result >= 0n ? result : result + P;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function modInverse(value) {
  return modPow(mod(value), P - 2n, P);
}

/** Whether 32 bytes decode to a point on ed25519; PDAs must not. */
function isOnCurve(bytes) {
  const copy = Uint8Array.from(bytes);
  copy[31] &= 0x7f;
  let y = 0n;
  for (let index = 31; index >= 0; index -= 1) y = (y << 8n) | BigInt(copy[index]);
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const v3 = mod(v * v * v);
  const x = mod(u * v3 * modPow(mod(u * v3 * v3 * v), (P - 5n) / 8n, P));
  const vx2 = mod(v * x * x);
  // A square root of u/v exists either directly or after a factor of sqrt(-1).
  return vx2 === u || vx2 === mod(-u);
}

export function findProgramAddress(seeds, programId) {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = createHash('sha256');
    for (const seed of seeds) hash.update(seed);
    hash.update(Uint8Array.of(bump));
    hash.update(programId.bytes);
    hash.update('ProgramDerivedAddress');
    const candidate = hash.digest();
    if (!isOnCurve(candidate)) return [new PublicKey(candidate), bump];
  }
  throw new Error('no viable bump seed');
}

export function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_2022_PROGRAM) {
  return findProgramAddress([owner.bytes, tokenProgram.bytes, mint.bytes], ASSOCIATED_TOKEN_PROGRAM)[0];
}

// --- encoding ----------------------------------------------------------------

export function u8(value) {
  return Uint8Array.of(value);
}

export function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

export function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

export function borshString(text) {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
}

function compactU16(value) {
  const out = [];
  let rest = value;
  for (;;) {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return out;
    }
    byte |= 0x80;
    out.push(byte);
  }
}

// --- transactions --------------------------------------------------------------

/**
 * A legacy transaction for `instructions`, signed by `signers`. The first
 * signer pays the fee. Each instruction is `{ programId, keys, data }` with
 * keys as `{ pubkey, isSigner, isWritable }`.
 */
export function buildTransaction(instructions, signers, recentBlockhash) {
  const payer = signers[0].publicKey;
  const metas = new Map();
  const touch = (pubkey, isSigner, isWritable) => {
    const key = pubkey.toString();
    const current = metas.get(key) ?? { pubkey, isSigner: false, isWritable: false };
    current.isSigner ||= isSigner;
    current.isWritable ||= isWritable;
    metas.set(key, current);
  };
  touch(payer, true, true);
  for (const instruction of instructions) {
    for (const meta of instruction.keys) touch(meta.pubkey, meta.isSigner, meta.isWritable);
    touch(instruction.programId, false, false);
  }

  const all = [...metas.values()];
  const rank = (meta) => (meta.isSigner ? 0 : 2) + (meta.isWritable ? 0 : 1);
  const ordered = [all[0], ...all.slice(1).sort((a, b) => rank(a) - rank(b))];
  const index = new Map(ordered.map((meta, position) => [meta.pubkey.toString(), position]));

  const signerCount = ordered.filter((meta) => meta.isSigner).length;
  const readonlySigned = ordered.filter((meta) => meta.isSigner && !meta.isWritable).length;
  const readonlyUnsigned = ordered.filter((meta) => !meta.isSigner && !meta.isWritable).length;

  const parts = [
    Uint8Array.of(signerCount, readonlySigned, readonlyUnsigned),
    Uint8Array.from(compactU16(ordered.length)),
    ...ordered.map((meta) => meta.pubkey.bytes),
    decodeBase58(recentBlockhash),
    Uint8Array.from(compactU16(instructions.length)),
  ];
  for (const instruction of instructions) {
    parts.push(
      Uint8Array.of(index.get(instruction.programId.toString())),
      Uint8Array.from(compactU16(instruction.keys.length)),
      Uint8Array.from(instruction.keys.map((meta) => index.get(meta.pubkey.toString()))),
      Uint8Array.from(compactU16(instruction.data.length)),
      Uint8Array.from(instruction.data),
    );
  }
  const message = Buffer.concat(parts);

  const bySigner = new Map(signers.map((signer) => [signer.publicKey.toString(), signer]));
  const signatures = ordered.slice(0, signerCount).map((meta) => {
    const signer = bySigner.get(meta.pubkey.toString());
    if (!signer) throw new Error(`missing signer ${meta.pubkey}`);
    return signer.sign(message);
  });
  return Buffer.concat([Uint8Array.from(compactU16(signerCount)), ...signatures, message]);
}

// --- JSON-RPC ------------------------------------------------------------------

export function createRpc(url) {
  let id = 0;
  const call = async (method, params = []) => {
    id += 1;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };

  const getAccount = async (pubkey) => {
    const result = await call('getAccountInfo', [pubkey.toString(), { encoding: 'base64', commitment: 'confirmed' }]);
    if (!result.value) return null;
    return { ...result.value, data: Buffer.from(result.value.data[0], 'base64') };
  };

  /** Send, wait for `confirmed`, and throw with the program logs on failure. */
  const send = async (instructions, signers) => {
    const { value } = await call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const wire = buildTransaction(instructions, signers, value.blockhash);
    const signature = await call('sendTransaction', [
      wire.toString('base64'),
      { encoding: 'base64', preflightCommitment: 'confirmed' },
    ]);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const { value: statuses } = await call('getSignatureStatuses', [[signature]]);
      const status = statuses[0];
      if (status?.err) {
        const tx = await call('getTransaction', [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
        throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}\n${(tx?.meta?.logMessages ?? []).join('\n')}`);
      }
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`transaction ${signature} was not confirmed in time`);
  };

  return { call, getAccount, send };
}
