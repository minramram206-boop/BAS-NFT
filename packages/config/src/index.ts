import { loadRepoJson } from './repo-json.ts';
import { NETWORK_CONFIG_FILES, parseNetworkConfig } from './network.ts';
import { resolveNetwork } from './env.ts';
import type { DistrictNetworkConfig, NetworkConfigFile, SupportedNetwork } from './types.ts';

export type { DistrictNetworkConfig, SupportedNetwork };
export {
  NETWORK_CONFIG_FIELDS,
  NETWORK_CONFIG_FILES,
  PRODUCTION_CRITICAL_ADDRESS_FIELDS,
  findPlaceholderAddresses,
  parseNetworkConfig,
  validateProductionReadiness,
} from './network.ts';
export { DEFAULT_NETWORK, NETWORK_ENV_VAR, resolveNetwork } from './env.ts';
export { findRepoRoot, loadRepoJson } from './repo-json.ts';

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
