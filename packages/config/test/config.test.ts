import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_NETWORK,
  DEVNET_CONFIG,
  MAINNET_CONFIG,
  NETWORK_CONFIG_FILES,
  REPO_PLACEHOLDER_ADDRESSES,
  findPlaceholderAddresses,
  findRepoRoot,
  getNetworkConfig,
  parseNetworkConfig,
  resolveNetwork,
  validateProductionReadiness,
} from '../dist/index.js';
import type { NetworkConfigFile } from '../dist/types.js';

const repoRoot = findRepoRoot();

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Minimal base58 encoder, enough to build a 32 byte fixture in the tests. */
function base58Encode(bytes: readonly number[]): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = BASE58_ALPHABET[0] + encoded;
  }
  return encoded;
}

/** A public key that is well-formed but is not one of the shipped placeholders. */
const REAL_LOOKING_KEY = base58Encode([
  0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
  0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01,
  0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
  0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x12,
]);

/** `district = "<id>"` under `[programs.<network>]` in programs/Anchor.toml. */
function anchorTomlProgramId(network: 'devnet' | 'mainnet'): string {
  const toml = readFileSync(join(repoRoot, 'programs/Anchor.toml'), 'utf8');
  const section = new RegExp(`\\[programs\\.${network}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
  assert.ok(section, `Anchor.toml must declare [programs.${network}]`);
  const match = /district\s*=\s*"([^"]+)"/.exec(section[1] as string);
  assert.ok(match, `Anchor.toml [programs.${network}] must declare district`);
  return match[1] as string;
}

function readConfigFile<T = NetworkConfigFile>(relativePath: string): T {
  const absolute = join(repoRoot, relativePath);
  assert.ok(existsSync(absolute), `${relativePath} must exist in the repository`);
  return JSON.parse(readFileSync(absolute, 'utf8')) as T;
}

describe('@bas/config', () => {
  it('loads the devnet config from config/devnet.json', () => {
    const file = readConfigFile(NETWORK_CONFIG_FILES.devnet);
    assert.equal(DEVNET_CONFIG.network, 'devnet');
    assert.equal(DEVNET_CONFIG.rpcUrl, file.rpcUrl);
    assert.equal(DEVNET_CONFIG.programId, file.programId);
    assert.equal(DEVNET_CONFIG.utilityTokenMint, file.utilityTokenMint);
    assert.equal(DEVNET_CONFIG.maxSupply, file.maxSupply);
  });

  it('loads the mainnet config from config/mainnet.json', () => {
    const file = readConfigFile(NETWORK_CONFIG_FILES['mainnet-beta']);
    assert.equal(MAINNET_CONFIG.network, 'mainnet-beta');
    assert.equal(MAINNET_CONFIG.programId, file.programId);
    assert.equal(MAINNET_CONFIG.utilityTokenMint, file.utilityTokenMint);
  });

  it('keeps devnet and mainnet program ids in parity', () => {
    assert.equal(DEVNET_CONFIG.programId, MAINNET_CONFIG.programId);
    assert.equal(DEVNET_CONFIG.maxSupply, MAINNET_CONFIG.maxSupply);
    assert.equal(DEVNET_CONFIG.tokenBurnRequired, MAINNET_CONFIG.tokenBurnRequired);
  });

  it('never defaults to mainnet', () => {
    assert.equal(DEFAULT_NETWORK, 'devnet');
    assert.equal(resolveNetwork(undefined), 'devnet');
    assert.equal(resolveNetwork('nonsense'), 'devnet');
    assert.equal(getNetworkConfig().network, 'devnet');
    assert.equal(getNetworkConfig('mainnet-beta').network, 'mainnet-beta');
  });

  it('rejects malformed config payloads', () => {
    const valid = readConfigFile(NETWORK_CONFIG_FILES.devnet);

    assert.throws(() => parseNetworkConfig({ ...valid, network: 'mainnet-beta' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, programId: 'has space' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, programId: '' }, 'devnet'));
    // 31 bytes: this is what used to break `declare_id!` at compile time
    assert.throws(
      () => parseNetworkConfig({ ...valid, programId: 'BASDistr1ct1111111111111111111111111111111' }, 'devnet'),
      /32 bytes decoded/,
    );
    // base58 has no 0, O, I or l
    assert.throws(
      () => parseNetworkConfig({ ...valid, utilityTokenMint: 'BASTokenOff1c1alPumpFun011111111111111111111' }, 'devnet'),
      /base58/,
    );
    assert.throws(() => parseNetworkConfig({ ...valid, rpcUrl: '' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, rpcUrl: 'http://insecure' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, maxSupply: 0 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, tokenBurnRequired: -1 }, 'devnet'));
  });

  it('reports placeholder addresses and blocks the launch gate', () => {
    const placeholders = findPlaceholderAddresses(DEVNET_CONFIG);
    assert.ok(placeholders.length > 0, 'the shipped config still uses placeholder addresses');
    assert.throws(() => validateProductionReadiness(DEVNET_CONFIG), /launch ready/);
    assert.throws(() => validateProductionReadiness(MAINNET_CONFIG), /launch ready/);
  });

  it('passes the launch gate once every address is a deployed key', () => {
    assert.ok(!REPO_PLACEHOLDER_ADDRESSES.has(REAL_LOOKING_KEY), 'fixture must not be a shipped placeholder');
    const ready = {
      ...DEVNET_CONFIG,
      programId: REAL_LOOKING_KEY,
      collectionMint: REAL_LOOKING_KEY,
      candyMachine: REAL_LOOKING_KEY,
      utilityTokenMint: REAL_LOOKING_KEY,
      treasuryAddress: REAL_LOOKING_KEY,
    };
    assert.deepEqual(findPlaceholderAddresses(ready), []);
    assert.equal(validateProductionReadiness(ready), ready);
  });

  it('rejects well-formed placeholders by value, not by shape', () => {
    const placeholders = findPlaceholderAddresses(DEVNET_CONFIG);
    assert.ok(
      placeholders.some(({ reason }) => reason.includes('repository placeholder')),
      'a well-formed but undeployed key must still block the launch gate',
    );
  });

  it('keeps the program id identical in every place it is declared', () => {
    const rust = readFileSync(join(repoRoot, 'programs/district/src/lib.rs'), 'utf8');
    const declared = /declare_id!\("([^"]+)"\)/.exec(rust);
    assert.ok(declared, 'lib.rs must declare the program id');

    assert.equal(declared[1], DEVNET_CONFIG.programId, 'lib.rs must match config/devnet.json');
    assert.equal(anchorTomlProgramId('devnet'), DEVNET_CONFIG.programId, 'Anchor.toml devnet drifted');
    assert.equal(anchorTomlProgramId('mainnet'), DEVNET_CONFIG.programId, 'Anchor.toml mainnet drifted');
  });
});
