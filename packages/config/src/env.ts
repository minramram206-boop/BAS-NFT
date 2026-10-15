import type { SupportedNetwork } from './types.js';

/** Environment variable that selects the active cluster. */
export const NETWORK_ENV_VAR = 'NEXT_PUBLIC_SOLANA_NETWORK';

/**
 * Environment variable that replaces the RPC endpoint of the manifest. A hosted
 * RPC plan carries a private key in its URL, which must not be committed; the
 * rest of the manifest stays as released.
 */
export const RPC_ENV_VAR = 'NEXT_PUBLIC_SOLANA_RPC_URL';

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

/**
 * The RPC endpoint from {@link RPC_ENV_VAR}, or `undefined` when it is not set.
 * It must be an https:// URL; plain http is accepted only for a local node on
 * devnet, so a mainnet deployment can never talk to an unencrypted endpoint.
 */
export function readRpcOverride(network: SupportedNetwork): string | undefined {
  const value = readProcessEnv(RPC_ENV_VAR)?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`[@bas/config] ${RPC_ENV_VAR} is not a valid URL`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && local && network === 'devnet');
  if (!allowed) {
    throw new Error(`[@bas/config] ${RPC_ENV_VAR} must be an https:// endpoint (http:// only for a local node on devnet)`);
  }
  return value;
}
