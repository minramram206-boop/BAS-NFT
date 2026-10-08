import type { SupportedNetwork } from './types.ts';

/** Environment variable that selects the active cluster. */
export const NETWORK_ENV_VAR = 'NEXT_PUBLIC_SOLANA_NETWORK';

const SUPPORTED_NETWORKS: readonly SupportedNetwork[] = ['devnet', 'mainnet-beta'];

/** Cluster used when nothing is configured. Mainnet is never the implicit default. */
export const DEFAULT_NETWORK: SupportedNetwork = 'devnet';

function readProcessEnv(name: string): string | undefined {
  return typeof process === 'undefined' || process.env === undefined
    ? undefined
    : process.env[name];
}

/**
 * Resolve the active cluster from an explicit argument or the environment.
 * Unknown values fall back to {@link DEFAULT_NETWORK}.
 */
export function resolveNetwork(explicit?: string | null): SupportedNetwork {
  const candidate = explicit ?? readProcessEnv(NETWORK_ENV_VAR) ?? DEFAULT_NETWORK;
  return (SUPPORTED_NETWORKS as readonly string[]).includes(candidate)
    ? (candidate as SupportedNetwork)
    : DEFAULT_NETWORK;
}
