import 'server-only';

import { getNetworkConfig, resolveNetwork } from '@bas/config';

/**
 * Cluster telemetry rendered by the shell.
 *
 * Built on the server from `config/<cluster>.json` through `@bas/config`, so the
 * header, price hint and status bar cannot drift from the manifest the app
 * actually runs against.
 */
export interface DistrictTelemetry {
  /** `devnet` or `mainnet-beta`, as resolved from the environment. */
  network: string;
  /** Uppercase cluster label for the header pill, e.g. `SOLANA DEVNET`. */
  networkLabel: string;
  /** District program id exactly as configured. */
  programId: string;
  /** Abbreviated program id for tickers. */
  programShort: string;
  rpcUrl: string;
  /** Mock collection supply for the UI preview. */
  maxSupply: number;
  /** Base training cost, a decimal string of raw token atoms. */
  baseTrainingCostAtoms: string;
  /** Official token decimals; devnet mirrors mainnet. */
  tokenDecimals: number;
  /** Maximum score (SPEC v2 §7). */
  maxScore: number;
  /** Official token burn share, in basis points (10000 = 100%). */
  burnBps: number;
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
    network: config.cluster,
    networkLabel: `SOLANA ${config.cluster.replace('-beta', '').toUpperCase()}`,
    programId: config.districtProgramId,
    programShort: abbreviate(config.districtProgramId),
    rpcUrl: config.rpcUrl,
    maxSupply: config.maxSupply,
    baseTrainingCostAtoms: config.baseTrainingCostAtoms,
    tokenDecimals: config.tokenDecimals,
    maxScore: config.maxScore,
    burnBps: config.burnBps,
    utilityTokenShort: abbreviate(config.utilityTokenMint, 4, 4),
  };
}
