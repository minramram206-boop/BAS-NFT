import { loadRepoJson } from './repo-json.js';
import { NETWORK_CONFIG_FILES, parseNetworkConfig } from './network.js';
import { resolveNetwork } from './env.js';
import type { DistrictNetworkConfig, NetworkConfigFile, SupportedNetwork } from './types.js';

export type { DistrictNetworkConfig, SupportedNetwork };
export {
  NETWORK_CONFIG_FIELDS,
  NETWORK_CONFIG_FILES,
  PRODUCTION_CRITICAL_ADDRESS_FIELDS,
  REPO_PLACEHOLDER_ADDRESSES,
  findPlaceholderAddresses,
  findPlaceholderConfiguration,
  parseNetworkConfig,
  validateProductionReadiness,
} from './network.js';
export { DEFAULT_NETWORK, NETWORK_ENV_VAR, resolveNetwork } from './env.js';
export { findRepoRoot, loadRepoJson } from './repo-json.js';

function loadConfig(network: SupportedNetwork): DistrictNetworkConfig {
  const file = NETWORK_CONFIG_FILES[network];
  return parseNetworkConfig(loadRepoJson<NetworkConfigFile>(file), network);
}

/** Validated devnet configuration, loaded from `config/devnet.json`. */
export const DEVNET_CONFIG: DistrictNetworkConfig = loadConfig('devnet');

/** Validated mainnet configuration, loaded from `config/mainnet.json`. */
export const MAINNET_CONFIG: DistrictNetworkConfig = loadConfig('mainnet-beta');

/**
 * Return the configuration of one cluster, defaulting to the cluster selected
 * by `NEXT_PUBLIC_SOLANA_NETWORK` and falling back to devnet.
 */
export function getNetworkConfig(
  network: string | null | undefined = undefined,
): DistrictNetworkConfig {
  return resolveNetwork(network) === 'mainnet-beta' ? MAINNET_CONFIG : DEVNET_CONFIG;
}
