import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_NETWORK,
  DEVNET_CONFIG,
  MAINNET_CONFIG,
  NETWORK_CONFIG_FILES,
  findPlaceholderAddresses,
  findRepoRoot,
  getNetworkConfig,
  parseNetworkConfig,
  resolveNetwork,
  validateProductionReadiness,
} from '../src/index.ts';

const repoRoot = findRepoRoot();

function readConfigFile(relativePath: string): Record<string, unknown> {
  const absolute = join(repoRoot, relativePath);
  assert.ok(existsSync(absolute), `${relativePath} must exist in the repository`);
  return JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
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

  it('passes the launch gate once every address is a real length key', () => {
    const key = 'BASDistr1ctProgram11111111111111111111111111';
    assert.ok(key.length === 43 || key.length === 44, 'fixture must look like a real public key');
    assert.ok([...key].every((c) => c !== '0' && c !== 'O' && c !== 'I' && c !== 'l'));
    const ready = {
      ...DEVNET_CONFIG,
      programId: key,
      collectionMint: key,
      candyMachine: key,
      utilityTokenMint: key,
      treasuryAddress: key,
    };
    assert.deepEqual(findPlaceholderAddresses(ready), []);
    assert.equal(validateProductionReadiness(ready), ready);
  });
});
