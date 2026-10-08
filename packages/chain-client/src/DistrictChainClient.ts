import { getNetworkConfig, type DistrictNetworkConfig, type SupportedNetwork } from '@bas/config';
import { DistrictClientError } from './errors.js';

/**
 * Typed read-side client for the District program.
 *
 * It only resolves cluster configuration and addresses. Signing, transaction
 * construction, and canonical state reads are added with the Solana kit
 * integration; browser state is never treated as canonical.
 */
export class DistrictChainClient {
  readonly config: DistrictNetworkConfig;

  constructor(network?: SupportedNetwork) {
    this.config = getNetworkConfig(network);
  }

  get network(): SupportedNetwork {
    return this.config.network;
  }

  get rpcEndpoint(): string {
    return this.config.rpcUrl;
  }

  get programId(): string {
    return this.config.programId;
  }

  get collectionMint(): string {
    return this.config.collectionMint;
  }

  get candyMachine(): string {
    return this.config.candyMachine;
  }

  get utilityTokenMint(): string {
    return this.config.utilityTokenMint;
  }

  get treasuryAddress(): string {
    return this.config.treasuryAddress;
  }

  /** Token amount burned per successful training, in raw token units. */
  get tokenBurnRequired(): number {
    return this.config.tokenBurnRequired;
  }

  /** Throw unless the client is talking to the expected cluster. */
  assertNetwork(expected: SupportedNetwork): void {
    if (this.config.network !== expected) {
      throw new DistrictClientError(
        `client is configured for "${this.config.network}" but "${expected}" is required`,
      );
    }
  }
}
