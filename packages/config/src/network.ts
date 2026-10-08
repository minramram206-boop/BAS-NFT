import type { DistrictNetworkConfig, NetworkConfigFile, SupportedNetwork } from './types.js';

/** Canonical manifest for each supported cluster. */
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

/** u64::MAX, written here as BigInt so the manifest parser never rounds it. */
const U64_MAX = 18_446_744_073_709_551_615n;

/** Reserved or obviously non-production URI hostnames blocked at launch. */
const PLACEHOLDER_URI_HOSTS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'localhost',
]);

/** Address fields present in the canonical SPEC §4.3 manifest. */
const ADDRESS_FIELDS = [
  'districtProgramId',
  'coreCollection',
  'candyMachine',
  'candyGuard',
  'utilityTokenMint',
  'solTreasury',
  'royaltyRecipient',
  'missionAuthority',
] as const satisfies readonly ConfigField[];

/** Address fields that must be real deployed keys before a public launch. */
export const PRODUCTION_CRITICAL_ADDRESS_FIELDS = [
  'districtProgramId',
  'coreCollection',
  'candyMachine',
  'candyGuard',
  'utilityTokenMint',
  'solTreasury',
  'royaltyRecipient',
  // Whoever holds this key can authorize Training Credits; credits are the one
  // half of training that cannot be bought (SPEC §5.3).
  'missionAuthority',
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
 * carry no value, so they have to be counted separately.
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
 * Placeholder addresses shipped with this repository.
 *
 * They are well-formed 32 byte public keys so every package, Anchor macro and
 * client can compile before deployment. None of them is deployed or controlled
 * by this project. The release gate rejects them by value, not by shape.
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
  // sha256("bas:placeholder:mission-authority-devnet")
  'A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn',
  // sha256("bas:placeholder:mission-authority-mainnet")
  'AeRoEz5UbbNf6Y3n1t3V8KNtgb7oWTXZAeYVB8osEvF6',
  // sha256("bas:placeholder:candy-guard-devnet")
  'Ajq1yqiok35wbd3uu9carDA9YqTt4t5V3hW3Q9YETVhD',
  // sha256("bas:placeholder:candy-guard-mainnet")
  'DLS5g62wAFpTr8sdeE2roEj3rm6cujo6HyuimDUWJTET',
  // sha256("bas:placeholder:royalty-recipient-devnet")
  'FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk',
  // sha256("bas:placeholder:royalty-recipient-mainnet")
  '9J5uTtsPvFKGLEyzw9NsRkrDACFMNJxEQu3nEMXM37su',
]);

function requirePositiveInteger(source: NetworkConfigFile, field: ConfigField): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalid(field, 'expected a positive safe integer');
  }
  return value;
}

function requireNonNegativeInteger(source: NetworkConfigFile, field: ConfigField): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(field, 'expected a non-negative safe integer');
  }
  return value;
}

function requireBoundedInteger(
  source: NetworkConfigFile,
  field: ConfigField,
  min: number,
  max: number,
): number {
  const value = requireNonNegativeInteger(source, field);
  if (value < min || value > max) {
    invalid(field, `expected an integer between ${min} and ${max}`);
  }
  return value;
}

function requireApprovedTemplateUriPrefix(
  source: NetworkConfigFile,
  templateId: number,
): string {
  const field: ConfigField = 'approvedTemplateUriPrefix';
  const value = requireString(source, field);
  const requiredSuffix = `/templates/${templateId}/`;
  let parsedUri: URL | undefined;
  try {
    parsedUri = new URL(value);
  } catch {
    // The field-specific error below handles malformed URL strings.
  }
  if (
    !parsedUri ||
    parsedUri.protocol !== 'https:' ||
    !parsedUri.hostname ||
    parsedUri.username.length > 0 ||
    parsedUri.password.length > 0 ||
    parsedUri.search.length > 0 ||
    parsedUri.hash.length > 0 ||
    !parsedUri.pathname.endsWith(requiredSuffix) ||
    !value.endsWith(requiredSuffix) ||
    value.length > 200 ||
    !/^[\x21-\x7E]+$/.test(value) ||
    value.includes('..') ||
    /[?#\\]/.test(value)
  ) {
    invalid(
      field,
      `expected an https:// URI prefix of at most 200 characters ending in "${requiredSuffix}"`,
    );
  }
  return value;
}

/** Decimal-string u64, to avoid JSON number rounding for token atoms. */
function requireU64Atoms(source: NetworkConfigFile, field: ConfigField): string {
  const value = source[field];
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    invalid(field, 'expected a positive decimal string of token atoms');
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) {
    invalid(field, 'exceeds the on-chain u64 maximum');
  }
  return value;
}

/**
 * Validate one cluster manifest and narrow it to {@link DistrictNetworkConfig}.
 *
 * The JSON keys follow SPEC v2 §4.3. The manifest is the one source of truth;
 * packages consume it rather than hardcoding addresses or economic values.
 */
export function parseNetworkConfig(
  source: NetworkConfigFile,
  expectedNetwork: SupportedNetwork,
): DistrictNetworkConfig {
  if (source.cluster !== expectedNetwork) {
    invalid('cluster', `expected "${expectedNetwork}", received "${String(source.cluster)}"`);
  }

  const maxScore = requirePositiveInteger(source, 'maxScore');
  if (maxScore !== 10) {
    invalid('maxScore', 'SPEC v2 §7 fixes the maximum score at 10');
  }
  const burnBps = requireNonNegativeInteger(source, 'burnBps');
  if (burnBps !== 10_000) {
    invalid('burnBps', 'SPEC v2 §5.3 fixes training-token burn at 100% (10000 bps)');
  }
  const approvedTemplateId = requireBoundedInteger(source, 'approvedTemplateId', 0, 0xffff_ffff);
  const approvedTemplateUriPrefix = requireApprovedTemplateUriPrefix(source, approvedTemplateId);

  return {
    cluster: expectedNetwork,
    rpcUrl: requireUrl(source, 'rpcUrl'),
    districtProgramId: requireAddress(source, 'districtProgramId'),
    coreCollection: requireAddress(source, 'coreCollection'),
    candyMachine: requireAddress(source, 'candyMachine'),
    candyGuard: requireAddress(source, 'candyGuard'),
    utilityTokenMint: requireAddress(source, 'utilityTokenMint'),
    solTreasury: requireAddress(source, 'solTreasury'),
    royaltyRecipient: requireAddress(source, 'royaltyRecipient'),
    missionAuthority: requireAddress(source, 'missionAuthority'),
    maxScore,
    baseTrainingCostAtoms: requireU64Atoms(source, 'baseTrainingCostAtoms'),
    burnBps,
    dailyMessageLimit: requirePositiveInteger(source, 'dailyMessageLimit'),
    tokenDecimals: requireBoundedInteger(source, 'tokenDecimals', 0, 9),
    approvedTemplateId,
    approvedTemplateUriPrefix,
    maxSupply: requirePositiveInteger(source, 'maxSupply'),
  };
}

/** Address fields that still hold a repository placeholder. */
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

/** Find unresolved addresses and reserved template-URI hosts in a launch config. */
export function findPlaceholderConfiguration(
  config: DistrictNetworkConfig,
): Array<{ field: ConfigField; value: string; reason: string }> {
  const placeholders = findPlaceholderAddresses(config);
  let parsedUri: URL | undefined;
  try {
    parsedUri = new URL(config.approvedTemplateUriPrefix);
  } catch {
    // Fail closed if a caller constructs DistrictNetworkConfig without using
    // the canonical parser.
  }

  const uriPrefix = config.approvedTemplateUriPrefix;
  const hostname = parsedUri?.hostname.toLowerCase() ?? '';
  const requiredSuffix = `/templates/${config.approvedTemplateId}/`;
  const invalidUri =
    !parsedUri ||
    parsedUri.protocol !== 'https:' ||
    !hostname ||
    parsedUri.username.length > 0 ||
    parsedUri.password.length > 0 ||
    parsedUri.search.length > 0 ||
    parsedUri.hash.length > 0 ||
    !parsedUri.pathname.endsWith(requiredSuffix) ||
    uriPrefix.length > 200 ||
    !/^[\x21-\x7E]+$/.test(uriPrefix) ||
    uriPrefix.includes('..') ||
    /[?#\\]/.test(uriPrefix);
  const placeholderHost =
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.example.com') ||
    hostname.endsWith('.example.net') ||
    hostname.endsWith('.example.org') ||
    PLACEHOLDER_URI_HOSTS.has(hostname);

  if (invalidUri || placeholderHost) {
    placeholders.push({
      field: 'approvedTemplateUriPrefix',
      value: uriPrefix,
      reason: invalidUri
        ? 'not a valid HTTPS template URI prefix'
        : 'reserved placeholder hostname, not a production metadata origin',
    });
  }
  return placeholders;
}

/**
 * Release gate: throw while any critical address or the metadata URI host is a placeholder.
 *
 * Call this from deployment and release checks, never from runtime rendering:
 * the repository intentionally ships placeholders so local UI and CI work
 * before the project has deployed.
 */
export function validateProductionReadiness(config: DistrictNetworkConfig): DistrictNetworkConfig {
  const placeholders = findPlaceholderConfiguration(config);
  if (placeholders.length > 0) {
    const details = placeholders
      .map(({ field, value, reason }) => `${field}="${value}" (${reason})`)
      .join(', ');
    throw new Error(
      `[@bas/config] ${config.cluster} configuration is not launch ready. ` +
        `Replace placeholder values with deployed public keys and a production metadata URI host: ${details}`,
    );
  }
  return config;
}

/** Field groups validated by {@link parseNetworkConfig}, for tests and tooling. */
export const NETWORK_CONFIG_FIELDS = {
  addresses: ADDRESS_FIELDS,
} as const;
