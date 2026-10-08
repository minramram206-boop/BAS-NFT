import type { DistrictNetworkConfig, NetworkConfigFile, SupportedNetwork } from './types.js';

/** Config file backing each supported cluster. */
export const NETWORK_CONFIG_FILES = {
  devnet: 'config/devnet.json',
  'mainnet-beta': 'config/mainnet.json',
} as const satisfies Record<SupportedNetwork, string>;

type ConfigField = keyof DistrictNetworkConfig;

/** Base58 alphabet used by Solana public keys (no 0, O, I, l). */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A 32 byte public key encodes to 43 or 44 base58 characters. */
const PUBKEY_LENGTH_RANGE = { min: 43, max: 44 } as const;

const ADDRESS_FIELDS = [
  'programId',
  'collectionMint',
  'candyMachine',
  'utilityTokenMint',
  'treasuryAddress',
] as const satisfies readonly ConfigField[];

/** Address fields that must be real deployed keys before a public launch. */
export const PRODUCTION_CRITICAL_ADDRESS_FIELDS = [
  'programId',
  'collectionMint',
  'candyMachine',
  'utilityTokenMint',
  'treasuryAddress',
] as const satisfies readonly ConfigField[];

function invalid(field: string, reason: string): never {
  throw new Error(`[@bas/config] invalid network configuration field "${field}": ${reason}`);
}

function requireString(source: NetworkConfigFile, field: ConfigField): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(field, 'expected a non-empty string');
  }
  return value;
}

function requireUrl(source: NetworkConfigFile, field: ConfigField): string {
  const value = requireString(source, field);
  if (!/^https:\/\/.+/.test(value)) {
    invalid(field, 'expected an https:// endpoint');
  }
  return value;
}

/**
 * Structural address check: a single non-empty token.
 *
 * The repository ships placeholder addresses before deployment, so base58 and
 * key-length correctness are enforced by {@link validateProductionReadiness}
 * instead of at load time.
 */
function requireAddress(source: NetworkConfigFile, field: ConfigField): string {
  const value = requireString(source, field);
  if (/\s/.test(value)) {
    invalid(field, 'must not contain whitespace');
  }
  return value;
}

function isBase58(value: string): boolean {
  return value.length > 0 && [...value].every((character) => BASE58_ALPHABET.includes(character));
}

function hasValidPublicKeyLength(value: string): boolean {
  return value.length >= PUBKEY_LENGTH_RANGE.min && value.length <= PUBKEY_LENGTH_RANGE.max;
}

function requireNonNegativeInteger(source: NetworkConfigFile, field: ConfigField): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(field, 'expected a non-negative integer');
  }
  return value;
}

function requirePositiveInteger(source: NetworkConfigFile, field: ConfigField): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    invalid(field, 'expected a positive integer');
  }
  return value;
}

/**
 * Validate one cluster config file and narrow it to {@link DistrictNetworkConfig}.
 *
 * Validation throws at module load, so a malformed or missing config file breaks
 * the build instead of silently shipping wrong values to a cluster.
 */
export function parseNetworkConfig(
  source: NetworkConfigFile,
  expectedNetwork: SupportedNetwork,
): DistrictNetworkConfig {
  if (source.network !== expectedNetwork) {
    invalid('network', `expected "${expectedNetwork}", received "${String(source.network)}"`);
  }

  return {
    network: expectedNetwork,
    rpcUrl: requireUrl(source, 'rpcUrl'),
    programId: requireAddress(source, 'programId'),
    collectionMint: requireAddress(source, 'collectionMint'),
    candyMachine: requireAddress(source, 'candyMachine'),
    utilityTokenMint: requireAddress(source, 'utilityTokenMint'),
    treasuryAddress: requireAddress(source, 'treasuryAddress'),
    tokenBurnRequired: requireNonNegativeInteger(source, 'tokenBurnRequired'),
    maxSupply: requirePositiveInteger(source, 'maxSupply'),
  };
}

/** Address fields that still hold a placeholder instead of a deployed public key. */
export function findPlaceholderAddresses(
  config: DistrictNetworkConfig,
): Array<{ field: ConfigField; value: string; reason: string }> {
  return PRODUCTION_CRITICAL_ADDRESS_FIELDS.flatMap((field) => {
    const value = config[field];
    if (!isBase58(value)) {
      return [{ field, value, reason: 'not base58' }];
    }
    if (!hasValidPublicKeyLength(value)) {
      return [
        {
          field,
          value,
          reason: `expected ${PUBKEY_LENGTH_RANGE.min}-${PUBKEY_LENGTH_RANGE.max} characters, received ${value.length}`,
        },
      ];
    }
    return [];
  });
}

/**
 * Release gate: throw while any address field still holds a placeholder.
 *
 * The repository ships placeholder addresses so the product can be built and
 * exercised before deployment. Call this from deployment and release checks,
 * never from runtime rendering.
 */
export function validateProductionReadiness(config: DistrictNetworkConfig): DistrictNetworkConfig {
  const placeholders = findPlaceholderAddresses(config);
  if (placeholders.length > 0) {
    const details = placeholders
      .map(({ field, value, reason }) => `${field}="${value}" (${reason})`)
      .join(', ');
    throw new Error(
      `[@bas/config] ${config.network} configuration is not launch ready. ` +
        `Replace these placeholders with deployed 43-44 character public keys: ${details}`,
    );
  }
  return config;
}

/** Field groups validated by {@link parseNetworkConfig}, for tests and tooling. */
export const NETWORK_CONFIG_FIELDS = {
  addresses: ADDRESS_FIELDS,
} as const;
