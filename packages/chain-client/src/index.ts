export * from './types';
import { CitizenStateOnChain, StatType, TrainingReceipt, MintResult } from './types';
import { getNetworkConfig } from '@bas/config';

export class DistrictChainClient {
  private config = getNetworkConfig();

  constructor(network?: 'devnet' | 'mainnet-beta') {
    if (network) {
      this.config = getNetworkConfig(network);
    }
  }

  getRpcEndpoint(): string {
    return this.config.rpcUrl;
  }

  getProgramId(): string {
    return this.config.programId;
  }

  getUtilityMint(): string {
    return this.config.utilityTokenMint;
  }
}
