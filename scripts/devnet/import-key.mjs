#!/usr/bin/env node
/**
 * Writes a key file for a DEVNET test wallet, so `transfer-asset.mjs` can sign
 * for it. A browser wallet exports its secret key as base58 text; the transfer
 * tool wants the `solana-keygen` JSON file. This turns one into the other on
 * this computer, and checks it belongs to the wallet you named.
 *
 * Use it only for a wallet that holds nothing but devnet test assets. The key
 * is asked for here, hidden as it is typed, and never printed. The file goes
 * into `.keys/`, which git ignores.
 *
 * Usage (from the repository root):
 *   node scripts/devnet/import-key.mjs <wallet address> [--name wallet-a]
 *
 * Delete the file when the test is done.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey, decodeBase58 } from './solana.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const flagged = new Set();
process.argv.forEach((arg, index) => {
  if (arg.startsWith('--')) {
    flagged.add(index);
    flagged.add(index + 1);
  }
});
const [expected] = process.argv.slice(2).filter((_, index) => !flagged.has(index + 2));
const name = option('name', 'wallet-a');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!expected) fail('Usage: node scripts/devnet/import-key.mjs <wallet address> [--name wallet-a]');
try {
  new PublicKey(expected);
} catch {
  fail(`"${expected}" is not a wallet address.`);
}
if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) fail('--name may only hold letters, digits, "-" and "_".');

const target = resolve(repoRoot, '.keys', `${name}.json`);
if (existsSync(target)) fail(`${target} already exists. Delete it first, or pick another --name.`);

/** Reads one line. On a terminal nothing is echoed back, so the key never lands on the screen. */
function readSecret(prompt) {
  return new Promise((resolveLine) => {
    process.stderr.write(prompt);
    if (!process.stdin.isTTY) {
      let text = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (text += chunk));
      process.stdin.on('end', () => resolveLine(text.split(/\r?\n/)[0] ?? ''));
      return;
    }
    let text = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          process.stderr.write('\n');
          process.exit(130);
        } else if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stderr.write('\n');
          resolveLine(text);
          return;
        } else if (char === '\u007f' || char === '\b') {
          text = text.slice(0, -1);
        } else {
          text += char;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

const raw = (await readSecret('Secret key of the devnet wallet (hidden): ')).trim();
if (raw === '') fail('Nothing was entered.');

/** A 64 byte or 32 byte secret from base58 text, or from the JSON array of a key file. */
function parseSecret(text) {
  if (text.startsWith('[')) {
    let list;
    try {
      list = JSON.parse(text);
    } catch {
      return null;
    }
    return Array.isArray(list) && list.every((n) => Number.isInteger(n) && n >= 0 && n < 256) ? Uint8Array.from(list) : null;
  }
  // Checked here so a bad character is reported without echoing what was typed.
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) return null;
  return decodeBase58(text);
}

const bytes = parseSecret(raw);
if (!bytes || (bytes.length !== 64 && bytes.length !== 32)) {
  fail('That is not a secret key: expected base58 text of 64 bytes (or 32), or the JSON array of a key file.');
}

const keypair = new Keypair(bytes.slice(0, 32));
if (keypair.publicKey.toString() !== expected) {
  fail(`That key belongs to a different wallet than ${expected}. Nothing was written.`);
}
if (bytes.length === 64 && Buffer.compare(Buffer.from(bytes.slice(32)), Buffer.from(keypair.publicKey.bytes)) !== 0) {
  fail('The key is damaged: its second half does not match its first half. Nothing was written.');
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, keypair.toFileContent(), { flag: 'wx', mode: 0o600 });
console.log(`Wallet     ${expected}`);
console.log(`Key file   ${target}`);
console.log('The key was not printed. Delete the file when the test is done.');
