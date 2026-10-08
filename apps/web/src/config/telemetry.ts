import 'server-only';

import { getNetworkConfig, resolveNetwork } from '@bas/config';

/**
 * Cluster telemetry rendered by the shell.
 *
 * Built on the server from `config/<network>.json` through `@bas/config`, so
 * the header and status bar can never advertise a cluster, program id, or
 * supply that disagrees with the configuration the app actually runs on.
 */
export interface DistrictTelemetry {
  /** `devnet` or `mainnet-beta`, as resolved from the environment. */
  network: string;
  /** Uppercase cluster label for the header pill, e.g. `SOLANA DEVNET`. */
  networkLabel: string;
  /** Program id exactly as configured. */
  programId: string;
  /** Abbreviated program id for tickers, e.g. `BASD...1111`. */
  programShort: string;
  rpcUrl: string;
  /** Collection supply configured for the cluster. */
  maxSupply: number;
  /** Utility tokens burned per training, in raw token units. */
  tokenBurnRequired: number;
  /** Abbreviated utility token mint. */
  utilityTokenShort: string;
}

function abbreviate(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** Resolve the telemetry of the cluster this deployment runs against. */
export function loadDistrictTelemetry(): DistrictTelemetry {
  const network = resolveNetwork();
  const config = getNetworkConfig(network);

  return {
    network: config.network,
    networkLabel: `SOLANA ${config.network.replace('-beta', '').toUpperCase()}`,
    programId: config.programId,
    programShort: abbreviate(config.programId),
    rpcUrl: config.rpcUrl,
    maxSupply: config.maxSupply,
    tokenBurnRequired: config.tokenBurnRequired,
    utilityTokenShort: abbreviate(config.utilityTokenMint, 4, 4),
  };
}
