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
  RPC_ENV_VAR,
  PRODUCTION_CRITICAL_ADDRESS_FIELDS,
  findPlaceholderAddresses,
  findPlaceholderConfiguration,
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
function anchorTomlProgramId(network: 'devnet' | 'mainnet', program = 'district'): string | undefined {
  const toml = readFileSync(join(repoRoot, 'programs/Anchor.toml'), 'utf8');
  const section = new RegExp(`\\[programs\\.${network}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
  assert.ok(section, `Anchor.toml must declare [programs.${network}]`);
  return new RegExp(`^${program}\\s*=\\s*"([^"]+)"`, 'm').exec(section[1] as string)?.[1];
}

function readConfigFile<T = NetworkConfigFile>(relativePath: string): T {
  const absolute = join(repoRoot, relativePath);
  assert.ok(existsSync(absolute), `${relativePath} must exist in the repository`);
  return JSON.parse(readFileSync(absolute, 'utf8')) as T;
}

describe('@bas/config', () => {
  it('loads the devnet config from config/devnet.json', () => {
    const file = readConfigFile(NETWORK_CONFIG_FILES.devnet);
    assert.equal(DEVNET_CONFIG.cluster, 'devnet');
    assert.equal(DEVNET_CONFIG.rpcUrl, file.rpcUrl);
    assert.equal(DEVNET_CONFIG.districtProgramId, file.districtProgramId);
    assert.equal(DEVNET_CONFIG.coreCollection, file.coreCollection);
    assert.equal(DEVNET_CONFIG.candyMachine, file.candyMachine);
    assert.equal(DEVNET_CONFIG.candyGuard, file.candyGuard);
    assert.equal(DEVNET_CONFIG.utilityTokenMint, file.utilityTokenMint);
    assert.equal(DEVNET_CONFIG.solTreasury, file.solTreasury);
    assert.equal(DEVNET_CONFIG.royaltyRecipient, file.royaltyRecipient);
    assert.equal(DEVNET_CONFIG.missionAuthority, file.missionAuthority);
    assert.equal(DEVNET_CONFIG.mintSigner, file.mintSigner);
    assert.equal(DEVNET_CONFIG.maxScore, file.maxScore);
    assert.equal(DEVNET_CONFIG.baseTrainingCostAtoms, file.baseTrainingCostAtoms);
    assert.equal(DEVNET_CONFIG.burnBps, file.burnBps);
    assert.equal(DEVNET_CONFIG.dailyMessageLimit, file.dailyMessageLimit);
    assert.equal(DEVNET_CONFIG.approvedTemplateId, file.approvedTemplateId);
    assert.equal(DEVNET_CONFIG.approvedTemplateUriPrefix, file.approvedTemplateUriPrefix);
    assert.equal(DEVNET_CONFIG.maxSupply, file.maxSupply);
    assert.equal(DEVNET_CONFIG.mintPriceLamports, file.mintPriceLamports);
    assert.equal(DEVNET_CONFIG.mintLimitPerWallet, file.mintLimitPerWallet);
  });

  it('loads the mainnet config from config/mainnet.json', () => {
    const file = readConfigFile(NETWORK_CONFIG_FILES['mainnet-beta']);
    assert.equal(MAINNET_CONFIG.cluster, 'mainnet-beta');
    assert.equal(MAINNET_CONFIG.districtProgramId, file.districtProgramId);
    assert.equal(MAINNET_CONFIG.coreCollection, file.coreCollection);
    assert.equal(MAINNET_CONFIG.utilityTokenMint, file.utilityTokenMint);
    assert.equal(MAINNET_CONFIG.missionAuthority, file.missionAuthority);
    assert.equal(MAINNET_CONFIG.baseTrainingCostAtoms, file.baseTrainingCostAtoms);
    assert.equal(MAINNET_CONFIG.approvedTemplateUriPrefix, file.approvedTemplateUriPrefix);
  });

  it('keeps devnet and mainnet program ids in parity', () => {
    assert.equal(DEVNET_CONFIG.districtProgramId, MAINNET_CONFIG.districtProgramId);
    assert.equal(DEVNET_CONFIG.maxSupply, MAINNET_CONFIG.maxSupply);
    assert.equal(DEVNET_CONFIG.maxScore, MAINNET_CONFIG.maxScore);
    assert.equal(DEVNET_CONFIG.baseTrainingCostAtoms, MAINNET_CONFIG.baseTrainingCostAtoms);
    assert.equal(DEVNET_CONFIG.burnBps, MAINNET_CONFIG.burnBps);
    assert.equal(DEVNET_CONFIG.dailyMessageLimit, MAINNET_CONFIG.dailyMessageLimit);
    assert.equal(DEVNET_CONFIG.tokenDecimals, MAINNET_CONFIG.tokenDecimals);
    assert.equal(DEVNET_CONFIG.approvedTemplateId, MAINNET_CONFIG.approvedTemplateId);
    // The template prefix differs on purpose: devnet serves metadata from the
    // devnet web app, mainnet from its own permanent host (D-0024).
    // D-0024: minting costs 0.01 SOL on both clusters.
    assert.equal(DEVNET_CONFIG.mintPriceLamports, '10000000');
    assert.equal(MAINNET_CONFIG.mintPriceLamports, DEVNET_CONFIG.mintPriceLamports);
    assert.equal(DEVNET_CONFIG.mintPrizeShareBps, 10000);
    assert.equal(MAINNET_CONFIG.mintPrizeShareBps, DEVNET_CONFIG.mintPrizeShareBps);
    // D-0055: one citizen per wallet in the public sale keeps the roles scarce.
    assert.equal(DEVNET_CONFIG.mintLimitPerWallet, 1);
    assert.equal(MAINNET_CONFIG.mintLimitPerWallet, DEVNET_CONFIG.mintLimitPerWallet);
    assert.notEqual(DEVNET_CONFIG.rpcUrl, MAINNET_CONFIG.rpcUrl, 'only endpoints may differ');
  });

  it('never defaults to mainnet', () => {
    assert.equal(DEFAULT_NETWORK, 'devnet');
    assert.equal(resolveNetwork(undefined), 'devnet');
    assert.equal(resolveNetwork('nonsense'), 'devnet');
    assert.equal(getNetworkConfig().cluster, 'devnet');
    assert.equal(getNetworkConfig('mainnet-beta').cluster, 'mainnet-beta');
  });

  it('rejects malformed config payloads', () => {
    const valid = readConfigFile(NETWORK_CONFIG_FILES.devnet);

    assert.throws(() => parseNetworkConfig({ ...valid, cluster: 'mainnet-beta' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, districtProgramId: 'has space' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, districtProgramId: '' }, 'devnet'));
    // 31 bytes: this is what used to break `declare_id!` at compile time
    assert.throws(
      () => parseNetworkConfig({ ...valid, districtProgramId: 'BASDistr1ct1111111111111111111111111111111' }, 'devnet'),
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
    // Token atoms are a positive integer string, never a floating-point number.
    assert.throws(() => parseNetworkConfig({ ...valid, baseTrainingCostAtoms: '0' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, baseTrainingCostAtoms: '-1' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, baseTrainingCostAtoms: 100 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, baseTrainingCostAtoms: '18446744073709551616' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, mintPriceLamports: '0' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, mintPriceLamports: 0.01 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, mintLimitPerWallet: 0 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, mintLimitPerWallet: '1' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, maxScore: 20 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, burnBps: 8000 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, dailyMessageLimit: 0 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, tokenDecimals: 10 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateId: -1 }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'http://metadata.example.invalid/templates/7/' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'https://metadata.example.invalid/templates/8/' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'https://user@metadata.example.invalid/templates/7/' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'https://metadata.example.invalid/templates/7?x=1' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'https://méta.example.invalid/templates/7/' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'https://metadata.example.invalid/templates/7/../templates/7/' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, approvedTemplateUriPrefix: 'https://metadata.example.invalid/templates/7\\\\preview/templates/7/' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, missionAuthority: 'not an address' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, mintSigner: 'not an address' }, 'devnet'));
    assert.throws(() => parseNetworkConfig({ ...valid, mintSigner: undefined }, 'devnet'));
  });

  it('reports placeholder addresses and blocks the launch gate', () => {
    // Devnet runs on the deployed program, collection and mint, so only
    // mainnet still carries placeholders and stays behind the gate.
    assert.deepEqual(findPlaceholderAddresses(DEVNET_CONFIG), []);
    assert.doesNotThrow(() => validateProductionReadiness(DEVNET_CONFIG));
    const placeholders = findPlaceholderAddresses(MAINNET_CONFIG);
    assert.ok(placeholders.length > 0, 'the shipped mainnet config still uses placeholder addresses');
    assert.throws(() => validateProductionReadiness(MAINNET_CONFIG), /launch ready/);
  });

  it('passes the launch gate once every address and metadata origin is production-ready', () => {
    assert.ok(!REPO_PLACEHOLDER_ADDRESSES.has(REAL_LOOKING_KEY), 'fixture must not be a shipped placeholder');
    const ready = {
      ...DEVNET_CONFIG,
      districtProgramId: REAL_LOOKING_KEY,
      coreCollection: REAL_LOOKING_KEY,
      candyMachine: REAL_LOOKING_KEY,
      utilityTokenMint: REAL_LOOKING_KEY,
      missionAuthority: REAL_LOOKING_KEY,
      mintSigner: REAL_LOOKING_KEY,
      solTreasury: REAL_LOOKING_KEY,
      candyGuard: REAL_LOOKING_KEY,
      royaltyRecipient: REAL_LOOKING_KEY,
      approvedTemplateUriPrefix: 'https://metadata.basnft.community/templates/7/',
    };
    assert.deepEqual(findPlaceholderAddresses(ready), []);
    assert.deepEqual(findPlaceholderConfiguration(ready), []);
    assert.equal(validateProductionReadiness(ready), ready);
  });

  it('keeps reserved metadata URI hosts behind the launch gate', () => {
    const readyAddresses = {
      ...MAINNET_CONFIG,
      districtProgramId: REAL_LOOKING_KEY,
      coreCollection: REAL_LOOKING_KEY,
      candyMachine: REAL_LOOKING_KEY,
      utilityTokenMint: REAL_LOOKING_KEY,
      missionAuthority: REAL_LOOKING_KEY,
      mintSigner: REAL_LOOKING_KEY,
      solTreasury: REAL_LOOKING_KEY,
      candyGuard: REAL_LOOKING_KEY,
      royaltyRecipient: REAL_LOOKING_KEY,
    };
    const placeholders = findPlaceholderConfiguration(readyAddresses);
    assert.ok(placeholders.some(({ field }) => field === 'approvedTemplateUriPrefix'));
    assert.throws(() => validateProductionReadiness(readyAddresses), /production metadata URI host/);
    assert.throws(
      () => validateProductionReadiness({ ...readyAddresses, approvedTemplateUriPrefix: 'not-a-url' }),
      /not a valid HTTPS template URI prefix/,
    );
  });

  // Devnet holds real devnet deployments once it is set up (D-0027); mainnet
  // must still block every critical address until its own launch.
  it('flags every critical mainnet address the repository ships', () => {
    const flagged = new Set(findPlaceholderAddresses(MAINNET_CONFIG).map(({ field }) => field));
    for (const field of PRODUCTION_CRITICAL_ADDRESS_FIELDS) {
      assert.ok(flagged.has(field), `mainnet.${field}="${MAINNET_CONFIG[field]}" slipped past the launch gate`);
    }
  });

  it('keeps the devnet program id out of a mainnet launch', () => {
    const programId = findPlaceholderAddresses(MAINNET_CONFIG).find(({ field }) => field === 'districtProgramId');
    assert.ok(programId?.reason.includes('devnet deployment'));
    assert.ok(!findPlaceholderAddresses(DEVNET_CONFIG).some(({ field }) => field === 'districtProgramId'));
  });

  it('refuses on mainnet any address, RPC or metadata origin copied from the devnet tests', () => {
    const fresh = (seed: number) => base58Encode(Array.from({ length: 32 }, (_, index) => (seed * 31 + index * 7 + 1) % 256));
    const mainnet = {
      ...MAINNET_CONFIG,
      districtProgramId: fresh(1),
      marketProgramId: fresh(2),
      coreCollection: fresh(3),
      candyMachine: fresh(4),
      candyGuard: fresh(5),
      utilityTokenMint: fresh(6),
      solTreasury: fresh(7),
      royaltyRecipient: fresh(8),
      missionAuthority: fresh(9),
      mintSigner: fresh(10),
      approvedTemplateUriPrefix: 'https://metadata.basnft.community/templates/7/',
    };
    assert.deepEqual(findPlaceholderConfiguration(mainnet), [], 'a mainnet of its own launches');
    assert.equal(validateProductionReadiness(mainnet), mainnet);

    // The devnet deployer is treasury and royalty recipient there; on mainnet it is refused in any role.
    const reused = {
      ...mainnet,
      missionAuthority: DEVNET_CONFIG.solTreasury,
      marketProgramId: DEVNET_CONFIG.marketProgramId as string,
      rpcUrl: DEVNET_CONFIG.rpcUrl,
      approvedTemplateUriPrefix: DEVNET_CONFIG.approvedTemplateUriPrefix,
    };
    assert.deepEqual(
      findPlaceholderConfiguration(reused).map(({ field, reason }) => [field, reason]),
      [
        ['missionAuthority', 'devnet test value (devnet solTreasury), not valid on mainnet-beta'],
        ['marketProgramId', 'devnet test value (devnet marketProgramId), not valid on mainnet-beta'],
        ['rpcUrl', 'devnet RPC endpoint'],
        ['approvedTemplateUriPrefix', 'devnet metadata origin'],
      ],
    );
    assert.throws(() => validateProductionReadiness(reused), /not launch ready.*marketProgramId/);
    assert.deepEqual(findPlaceholderConfiguration(DEVNET_CONFIG), [], 'devnet itself is not compared with itself');
  });

  it('lists a devnet program id once, not as both placeholder and reuse', () => {
    const fields = findPlaceholderConfiguration(MAINNET_CONFIG).map(({ field }) => field);
    assert.equal(fields.filter((field) => field === 'districtProgramId').length, 1);
  });

  it('rejects well-formed placeholders by value, not by shape', () => {
    const placeholders = findPlaceholderAddresses(MAINNET_CONFIG);
    assert.ok(
      placeholders.some(({ reason }) => reason.includes('repository placeholder')),
      'a well-formed but undeployed key must still block the launch gate',
    );
  });

  it('keeps the program id identical in every place it is declared', () => {
    const rust = readFileSync(join(repoRoot, 'programs/district/src/lib.rs'), 'utf8');
    const declared = /declare_id!\("([^"]+)"\)/.exec(rust);
    assert.ok(declared, 'lib.rs must declare the program id');

    assert.equal(declared[1], DEVNET_CONFIG.districtProgramId, 'lib.rs must match config/devnet.json');
    assert.equal(anchorTomlProgramId('devnet'), DEVNET_CONFIG.districtProgramId, 'Anchor.toml devnet drifted');
    assert.equal(anchorTomlProgramId('mainnet'), DEVNET_CONFIG.districtProgramId, 'Anchor.toml mainnet drifted');
  });

  it('keeps the market program id identical in every place, and off mainnet', () => {
    const rust = readFileSync(join(repoRoot, 'programs/market/src/lib.rs'), 'utf8');
    const declared = /declare_id!\("([^"]+)"\)/.exec(rust);
    assert.ok(declared, 'market lib.rs must declare the program id');
    assert.equal(DEVNET_CONFIG.marketProgramId, declared[1], 'config/devnet.json must match market lib.rs');
    assert.equal(anchorTomlProgramId('devnet', 'market'), declared[1], 'Anchor.toml devnet market drifted');
    // The market stays on devnet until an external audit (docs/MARKET.md).
    assert.equal(MAINNET_CONFIG.marketProgramId, undefined);
    assert.equal(anchorTomlProgramId('mainnet', 'market'), undefined);
  });

  it('keeps the prize vault program id identical in every place', () => {
    const rust = readFileSync(join(repoRoot, 'programs/prize_vault/src/lib.rs'), 'utf8');
    const declared = /declare_id!\("([^"]+)"\)/.exec(rust);
    assert.ok(declared, 'prize_vault lib.rs must declare the program id');
    assert.equal(DEVNET_CONFIG.prizeVaultProgramId, declared[1], 'config/devnet.json must match prize_vault lib.rs');
    assert.equal(anchorTomlProgramId('devnet', 'prize_vault'), declared[1], 'Anchor.toml devnet prize_vault drifted');
    // Mainnet gets a fresh keypair before launch, never the devnet one.
    assert.equal(MAINNET_CONFIG.prizeVaultProgramId, undefined);
  });

  it('allows the fast prize clock only on devnet, with a prize vault', () => {
    const devnet = readConfigFile<Record<string, unknown>>('config/devnet.json');
    assert.equal(parseNetworkConfig(devnet as NetworkConfigFile, 'devnet').prizeClock, 'devnet-fast');
    assert.throws(() => parseNetworkConfig({ ...devnet, prizeClock: 'fast' } as NetworkConfigFile, 'devnet'), /prizeClock/);
    const { prizeVaultProgramId: _vault, ...noVault } = devnet;
    assert.throws(() => parseNetworkConfig(noVault as NetworkConfigFile, 'devnet'), /prizeClock/);
    const { prizeClock: _clock, ...noClock } = noVault;
    assert.equal(parseNetworkConfig(noClock as NetworkConfigFile, 'devnet').prizeVaultProgramId, undefined);
  });

  it('accepts a manifest without a market and refuses a malformed one', () => {
    const { marketProgramId: _unused, auctionClock: _clock, ...withoutMarket } = readConfigFile<Record<string, unknown>>('config/devnet.json');
    assert.equal(parseNetworkConfig(withoutMarket as NetworkConfigFile, 'devnet').marketProgramId, undefined);
    assert.throws(() => parseNetworkConfig({ ...withoutMarket, marketProgramId: 'not a key' } as NetworkConfigFile, 'devnet'));
  });

  it('allows the fast auction clock only on devnet, with a market, by its one name', () => {
    const devnet = readConfigFile<Record<string, unknown>>('config/devnet.json');
    assert.equal(parseNetworkConfig({ ...devnet, auctionClock: 'devnet-fast' } as NetworkConfigFile, 'devnet').auctionClock, 'devnet-fast');
    const { auctionClock: _clock, ...realClock } = devnet;
    assert.equal(parseNetworkConfig(realClock as NetworkConfigFile, 'devnet').auctionClock, undefined);
    assert.throws(() => parseNetworkConfig({ ...devnet, auctionClock: 'fast' } as NetworkConfigFile, 'devnet'), /auctionClock/);
    const { marketProgramId: _market, ...noMarket } = devnet;
    assert.throws(() => parseNetworkConfig({ ...noMarket, auctionClock: 'devnet-fast' } as NetworkConfigFile, 'devnet'), /auctionClock/);
    const mainnet = readConfigFile<Record<string, unknown>>('config/mainnet.json');
    assert.throws(
      () => parseNetworkConfig({ ...mainnet, marketProgramId: devnet.marketProgramId, auctionClock: 'devnet-fast' } as NetworkConfigFile, 'mainnet-beta'),
      /auctionClock/,
    );
    assert.equal(MAINNET_CONFIG.auctionClock, undefined);
  });
});

describe('RPC endpoint override', () => {
  function withRpc<T>(value: string | undefined, action: () => T): T {
    const before = process.env[RPC_ENV_VAR];
    if (value === undefined) delete process.env[RPC_ENV_VAR];
    else process.env[RPC_ENV_VAR] = value;
    try {
      return action();
    } finally {
      if (before === undefined) delete process.env[RPC_ENV_VAR];
      else process.env[RPC_ENV_VAR] = before;
    }
  }

  it('keeps the manifest endpoint when nothing is set', () => {
    assert.equal(withRpc(undefined, () => getNetworkConfig('devnet').rpcUrl), DEVNET_CONFIG.rpcUrl);
    assert.equal(withRpc('  ', () => getNetworkConfig('devnet').rpcUrl), DEVNET_CONFIG.rpcUrl);
  });

  it('replaces only the endpoint', () => {
    const url = 'https://rpc.example.test/?api-key=secret';
    const config = withRpc(url, () => getNetworkConfig('devnet'));
    assert.equal(config.rpcUrl, url);
    assert.deepEqual({ ...config, rpcUrl: '' }, { ...DEVNET_CONFIG, rpcUrl: '' });
    assert.equal(DEVNET_CONFIG.rpcUrl, readConfigFile(NETWORK_CONFIG_FILES.devnet).rpcUrl, 'the shared config is not changed');
  });

  it('accepts plain http only for a local node on devnet', () => {
    assert.equal(withRpc('http://127.0.0.1:8899', () => getNetworkConfig('devnet').rpcUrl), 'http://127.0.0.1:8899');
    assert.equal(withRpc('http://localhost:8899', () => getNetworkConfig('devnet').rpcUrl), 'http://localhost:8899');
    assert.throws(() => withRpc('http://127.0.0.1:8899', () => getNetworkConfig('mainnet-beta')), /https/);
    assert.throws(() => withRpc('http://rpc.example.test', () => getNetworkConfig('devnet')), /https/);
  });

  it('refuses a value that is not a URL', () => {
    assert.throws(() => withRpc('not a url', () => getNetworkConfig('devnet')), /not a valid URL/);
  });
});
