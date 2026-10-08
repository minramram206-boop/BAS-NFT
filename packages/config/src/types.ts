/**
 * Network identity values for one Solana cluster.
 *
 * The canonical data lives in `config/devnet.json` and `config/mainnet.json`
 * (paths mandated by `docs/id/TECH_STACK_ID.md` section 11). This type is the
 * contract those files must satisfy; it is never a second copy of the values.
 */
export interface DistrictNetworkConfig {
  network: SupportedNetwork;
  rpcUrl: string;
  programId: string;
  collectionMint: string;
  candyMachine: string;
  utilityTokenMint: string;
  tokenBurnRequired: number;
  maxSupply: number;
  treasuryAddress: string;
}

export type SupportedNetwork = 'devnet' | 'mainnet-beta';

export type NetworkConfigFile = Record<keyof DistrictNetworkConfig, unknown>;
