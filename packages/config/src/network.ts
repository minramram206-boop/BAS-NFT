import type { DistrictNetworkConfig, NetworkConfigFile, SupportedNetwork } from './types.js';
import { PUBKEY_LENGTH_RANGE, PUBLIC_KEY_BYTES, isWellFormedPublicKey } from './pubkey.js';
import { MAX_TEMPLATE_URI_PREFIX_LENGTH, isValidTemplateUriPrefix } from './template-uri.js';

/** Canonical manifest for each supported cluster. */
export const NETWORK_CONFIG_FILES = {
  devnet: 'config/devnet.json',
  'mainnet-beta': 'config/mainnet.json',
} as const satisfies Record<SupportedNetwork, string>;

type ConfigField = keyof DistrictNetworkConfig;

/** u64::MAX, written here as BigInt so the manifest parser never rounds it. */
const U64_MAX = 18_446_744_073_709_551_615n;

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

function requireApprovedTemplateUriPrefix(source: NetworkConfigFile, templateId: number): string {
  const field: ConfigField = 'approvedTemplateUriPrefix';
  const value = requireString(source, field);
  if (!isValidTemplateUriPrefix(value, templateId)) {
    invalid(
      field,
      `expected an https:// URI prefix of at most ${MAX_TEMPLATE_URI_PREFIX_LENGTH} characters ` +
        `ending in "/templates/${templateId}/"`,
    );
  }
  return value;
}

/** Decimal-string u64, to avoid JSON number rounding for token atoms. */
function requireU64Atoms(source: NetworkConfigFile, field: ConfigField): string {
  const value = source[field];
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    invalid(field, 'expected a positive decimal string of base units');
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
    mintPriceLamports: requireU64Atoms(source, 'mintPriceLamports'),
  };
}

/** Field groups validated by {@link parseNetworkConfig}, for tests and tooling. */
export const NETWORK_CONFIG_FIELDS = {
  addresses: ADDRESS_FIELDS,
} as const;
