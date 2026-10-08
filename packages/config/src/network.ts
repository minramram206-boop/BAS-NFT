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

/** Solana public keys are always 32 bytes. */
const PUBLIC_KEY_BYTES = 32;

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
 * Structural address check: base58, 43-44 characters, exactly 32 bytes decoded.
 *
 * Being well-formed is not the same as being deployed, so the placeholder
 * addresses the repository ships still pass this check. Whether an address is
 * real is decided by {@link validateProductionReadiness}.
 *
 * Enforcing the shape at load time matters because `declare_id!` parses the
 * program id at compile time: a 31 byte placeholder used to make `cargo check`
 * fail with an opaque error instead of a clear one.
 */
function requireAddress(source: NetworkConfigFile, field: ConfigField): string {
  const value = requireString(source, field);
  if (/\s/.test(value)) {
    invalid(field, 'must not contain whitespace');
  }
  if (!isWellFormedPublicKey(value)) {
    invalid(
      field,
      `expected a ${PUBKEY_LENGTH_RANGE.min}-${PUBKEY_LENGTH_RANGE.max} character base58 public key ` +
        `(${PUBLIC_KEY_BYTES} bytes decoded), received "${value}"`,
    );
  }
  return value;
}

function isBase58(value: string): boolean {
  return value.length > 0 && [...value].every((character) => BASE58_ALPHABET.includes(character));
}

function hasValidPublicKeyLength(value: string): boolean {
  return value.length >= PUBKEY_LENGTH_RANGE.min && value.length <= PUBKEY_LENGTH_RANGE.max;
}

/**
 * Decoded byte length of a base58 string.
 *
 * Leading `1` characters are the base58 encoding of leading zero bytes and
 * carry no value, so they have to be counted separately: a public key whose
 * first byte is zero would otherwise look one byte short.
 */
function decodedByteLength(value: string): number {
  let leadingZeros = 0;
  for (const character of value) {
    if (character !== BASE58_ALPHABET[0]) break;
    leadingZeros += 1;
  }

  let bits = 0n;
  for (const character of value) {
    bits = bits * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  let significantBytes = 0;
  while (bits > 0n) {
    bits >>= 8n;
    significantBytes += 1;
  }
  return leadingZeros + significantBytes;
}

function isWellFormedPublicKey(value: string): boolean {
  return isBase58(value) && hasValidPublicKeyLength(value) && decodedByteLength(value) === PUBLIC_KEY_BYTES;
}

/**
 * Placeholder addresses that ship with the repository.
 *
 * They are well-formed 32 byte public keys so that `declare_id!`, Anchor and
 * the client all compile and run, but none of them is deployed and none of them
 * is controlled by this project. {@link findPlaceholderAddresses} rejects them
 * by value, not by shape, so the release gate still blocks a launch.
 */
export const REPO_PLACEHOLDER_ADDRESSES = new Set<string>([
  // programs/district/keypair.json public half, generated and never deployed
  'D8HGhXUqHx7UXysCMEBDzvd3FS4XGEMNjCR6Eaj8CRbV',
  // sha256("bas:placeholder:utility-token-mint")
  '6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG',
  'BASCo11ect1onDevnet111111111111111111111',
  'BASCandyMach1neDevnet1111111111111111111111',
  'BASCandyMach1neMa1nnet111111111111111111111',
  'BASCo11ect1onMa1nnetBeta1111111111111111111',
  'BASTreasuryDevnet11111111111111111111111111',
  'BASTreasuryMa1nnetBeta111111111111111111111',
]);

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
    if (!isWellFormedPublicKey(value)) {
      return [{ field, value, reason: 'not a well-formed 32 byte base58 public key' }];
    }
    if (REPO_PLACEHOLDER_ADDRESSES.has(value)) {
      return [{ field, value, reason: 'repository placeholder, never deployed' }];
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
        `Replace these placeholders with deployed public keys: ${details}`,
    );
  }
  return config;
}

/** Field groups validated by {@link parseNetworkConfig}, for tests and tooling. */
export const NETWORK_CONFIG_FIELDS = {
  addresses: ADDRESS_FIELDS,
} as const;
