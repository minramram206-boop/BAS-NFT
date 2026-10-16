import type { DistrictNetworkConfig } from './types.js';
import { isWellFormedPublicKey } from './pubkey.js';
import { isValidTemplateUriPrefix } from './template-uri.js';

type ConfigField = keyof DistrictNetworkConfig;

/** One value that keeps a configuration from launching, and why. */
export interface ReadinessProblem {
  field: ConfigField;
  value: string;
  reason: string;
}

/** Reserved or obviously non-production URI hostnames blocked at launch. */
const PLACEHOLDER_URI_HOSTS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'localhost',
]);

/** Reserved TLDs and documentation domains that can never be a production origin. */
function isPlaceholderHost(hostname: string): boolean {
  const reservedSuffixes = ['.invalid', '.example', '.test', '.localhost', '.example.com', '.example.net', '.example.org'];
  return PLACEHOLDER_URI_HOSTS.has(hostname) || reservedSuffixes.some((suffix) => hostname.endsWith(suffix));
}

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
  // Co-signs every public mint; a placeholder here means no mint can succeed.
  'mintSigner',
] as const satisfies readonly ConfigField[];

/**
 * Placeholder addresses shipped with this repository.
 *
 * They are well-formed 32 byte public keys so every package, Anchor macro and
 * client can compile before deployment. None of them is deployed or controlled
 * by this project. The release gate rejects them by value, not by shape.
 */
export const REPO_PLACEHOLDER_ADDRESSES = new Set<string>([
  // Earlier placeholder program id; its keypair was generated and never deployed
  'D8HGhXUqHx7UXysCMEBDzvd3FS4XGEMNjCR6Eaj8CRbV',
  // sha256("bas:placeholder:utility-token-mint")
  '6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG',
  // Vanity placeholders used verbatim in config/devnet.json and config/mainnet.json.
  'BASCo11ect1onDevnet1111111111111111111111111',
  'BASCo11ect1onMa1nnet111111111111111111111111',
  'BASCandyMach1neDevnet1111111111111111111111',
  'BASCandyMach1neMa1nnet111111111111111111111',
  'BASTreasuryDevnet11111111111111111111111111',
  'BASTreasuryMa1nnet1111111111111111111111111',
  // sha256("bas:placeholder:mission-authority-devnet")
  'A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn',
  // sha256("bas:placeholder:mission-authority-mainnet")
  'AeRoEz5UbbNf6Y3n1t3V8KNtgb7oWTXZAeYVB8osEvF6',
  // sha256("bas:placeholder:mint-signer-devnet")
  'D1ZevHcBHGmYAMVWVXbRjMBfqGLttvw1k1XHup563HT5',
  // sha256("bas:placeholder:mint-signer-mainnet")
  '2V64HhRwC34uZpBYP619fhpznSSHDoMSYEx8jYbgpK6R',
  // sha256("bas:placeholder:candy-guard-devnet")
  'Ajq1yqiok35wbd3uu9carDA9YqTt4t5V3hW3Q9YETVhD',
  // sha256("bas:placeholder:candy-guard-mainnet")
  'DLS5g62wAFpTr8sdeE2roEj3rm6cujo6HyuimDUWJTET',
  // sha256("bas:placeholder:royalty-recipient-devnet")
  'FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk',
  // sha256("bas:placeholder:royalty-recipient-mainnet")
  '9J5uTtsPvFKGLEyzw9NsRkrDACFMNJxEQu3nEMXM37su',
]);

/**
 * Keys deployed on devnet only. The program id has to be the same in
 * `declare_id!`, `Anchor.toml` and both config files until mainnet gets its
 * own keypair, so the mainnet gate rejects it by value (D-0027).
 */
export const DEVNET_ONLY_ADDRESSES = new Set<string>([
  // programs/district/keypair.json, the devnet deployment
  '82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym',
]);

/** Address fields that still hold a repository placeholder. */
export function findPlaceholderAddresses(config: DistrictNetworkConfig): ReadinessProblem[] {
  return PRODUCTION_CRITICAL_ADDRESS_FIELDS.flatMap((field) => {
    const value = config[field];
    if (!isWellFormedPublicKey(value)) {
      return [{ field, value, reason: 'not a well-formed 32 byte base58 public key' }];
    }
    if (REPO_PLACEHOLDER_ADDRESSES.has(value)) {
      return [{ field, value, reason: 'repository placeholder, never deployed' }];
    }
    if (config.cluster !== 'devnet' && DEVNET_ONLY_ADDRESSES.has(value)) {
      return [{ field, value, reason: 'devnet deployment, not valid on this cluster' }];
    }
    return [];
  });
}

/** Every field whose value may be a key or account address, the optional programs included. */
const ADDRESS_LIKE_FIELDS = [
  ...PRODUCTION_CRITICAL_ADDRESS_FIELDS,
  'marketProgramId',
  'prizeVaultProgramId',
] as const satisfies readonly ConfigField[];

/**
 * Values another cluster copied from the devnet manifest. Everything on
 * devnet is a test deployment: its program keypairs, wallets and collection
 * have been handled in the open (one program keypair is in the public git
 * history), so none of it may reach mainnet. Any devnet address is refused
 * in any address field, since one devnet wallet fills several roles there;
 * the RPC endpoint and the metadata origin are compared too.
 */
export function findDevnetReuse(config: DistrictNetworkConfig, devnet: DistrictNetworkConfig): ReadinessProblem[] {
  if (config.cluster === 'devnet') return [];
  const devnetAddresses = new Map<string, ConfigField>();
  for (const field of ADDRESS_LIKE_FIELDS) {
    const value = devnet[field];
    if (value !== undefined && !devnetAddresses.has(value)) devnetAddresses.set(value, field);
  }
  const problems: ReadinessProblem[] = [];
  for (const field of ADDRESS_LIKE_FIELDS) {
    const value = config[field];
    const devnetField = value === undefined ? undefined : devnetAddresses.get(value);
    if (value !== undefined && devnetField !== undefined) {
      problems.push({ field, value, reason: `devnet test value (devnet ${devnetField}), not valid on ${config.cluster}` });
    }
  }
  if (config.rpcUrl === devnet.rpcUrl) {
    problems.push({ field: 'rpcUrl', value: config.rpcUrl, reason: 'devnet RPC endpoint' });
  }
  const origin = (prefix: string): string | undefined => {
    try {
      return new URL(prefix).host.toLowerCase();
    } catch {
      return undefined;
    }
  };
  const metadataHost = origin(config.approvedTemplateUriPrefix);
  if (metadataHost !== undefined && metadataHost === origin(devnet.approvedTemplateUriPrefix)) {
    problems.push({ field: 'approvedTemplateUriPrefix', value: config.approvedTemplateUriPrefix, reason: 'devnet metadata origin' });
  }
  return problems;
}

/**
 * Find unresolved addresses and reserved template-URI hosts in a launch
 * config, and, given the devnet manifest, every devnet test value it reuses.
 */
export function findPlaceholderConfiguration(config: DistrictNetworkConfig, devnet?: DistrictNetworkConfig): ReadinessProblem[] {
  const placeholders = findPlaceholderAddresses(config);
  const uriPrefix = config.approvedTemplateUriPrefix;
  const invalidUri = !isValidTemplateUriPrefix(uriPrefix, config.approvedTemplateId);
  const placeholderHost = !invalidUri && isPlaceholderHost(new URL(uriPrefix).hostname.toLowerCase());

  if (invalidUri || placeholderHost) {
    placeholders.push({
      field: 'approvedTemplateUriPrefix',
      value: uriPrefix,
      reason: invalidUri
        ? 'not a valid HTTPS template URI prefix'
        : 'reserved placeholder hostname, not a production metadata origin',
    });
  }
  // One line per field: a devnet key already named a placeholder is not listed twice.
  const reported = new Set(placeholders.map(({ field }) => field));
  for (const problem of devnet ? findDevnetReuse(config, devnet) : []) {
    if (!reported.has(problem.field)) placeholders.push(problem);
  }
  return placeholders;
}

/**
 * Release gate: throw while any critical address or the metadata URI host is
 * a placeholder, or, given the devnet manifest, a devnet test value.
 *
 * The servers call it when they start on mainnet, and the web build when it
 * targets mainnet; on devnet the repository intentionally ships test values
 * so local UI and CI work.
 */
export function validateProductionReadiness(config: DistrictNetworkConfig, devnet?: DistrictNetworkConfig): DistrictNetworkConfig {
  const placeholders = findPlaceholderConfiguration(config, devnet);
  if (placeholders.length > 0) {
    const details = placeholders
      .map(({ field, value, reason }) => `${field}="${value}" (${reason})`)
      .join(', ');
    throw new Error(
      `[@bas/config] ${config.cluster} configuration is not launch ready. ` +
        `Replace placeholder and devnet values with this cluster's own deployed public keys, RPC and a production metadata URI host: ${details}`,
    );
  }
  return config;
}
