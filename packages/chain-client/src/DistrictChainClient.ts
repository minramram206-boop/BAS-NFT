import { getNetworkConfig, type DistrictNetworkConfig, type SupportedNetwork } from '@bas/config';
import { DistrictClientError } from './errors.js';
import { trainingCostAtoms } from './stats.js';

/**
 * Typed read-side client for the District program.
 *
 * It resolves the canonical per-network manifest and provides pure protocol
 * helpers. Signing, transaction construction, wallet integration and canonical
 * state reads remain behind later adapters; browser state is never treated as
 * canonical.
 */
export class DistrictChainClient {
  readonly config: DistrictNetworkConfig;

  constructor(network?: SupportedNetwork) {
    this.config = getNetworkConfig(network);
  }

  get network(): SupportedNetwork {
    return this.config.cluster;
  }

  get rpcEndpoint(): string {
    return this.config.rpcUrl;
  }

  /** Address under the spec's manifest key `districtProgramId`. */
  get programId(): string {
    return this.config.districtProgramId;
  }

  /** Official Metaplex Core collection. */
  get collectionMint(): string {
    return this.config.coreCollection;
  }

  get candyMachine(): string {
    return this.config.candyMachine;
  }

  get candyGuard(): string {
    return this.config.candyGuard;
  }

  get utilityTokenMint(): string {
    return this.config.utilityTokenMint;
  }

  get treasuryAddress(): string {
    return this.config.solTreasury;
  }

  get royaltyRecipient(): string {
    return this.config.royaltyRecipient;
  }

  /** Key that signs authorized mission claims. */
  get missionAuthority(): string {
    return this.config.missionAuthority;
  }

  get maxScore(): number {
    return this.config.maxScore;
  }

  /**
   * Base training price in atoms. Kept as `bigint` so a caller cannot round a
   * u64 through JavaScript's 53-bit integer limit.
   */
  get baseTrainingCostAtoms(): bigint {
    return BigInt(this.config.baseTrainingCostAtoms);
  }

  get tokenDecimals(): number {
    return this.config.tokenDecimals;
  }

  get burnBps(): number {
    return this.config.burnBps;
  }

  get dailyMessageLimit(): number {
    return this.config.dailyMessageLimit;
  }

  /** Immutable Core metadata template id required during registration. */
  get approvedTemplateId(): number {
    return this.config.approvedTemplateId;
  }

  /** URI prefix stored in the program-owned approved-template PDA. */
  get approvedTemplateUriPrefix(): string {
    return this.config.approvedTemplateUriPrefix;
  }

  /**
   * Cost in token atoms to raise one stat at `currentScore` by one level.
   *
   * SPEC v2 §5.3: `base_training_cost × (current_score + 1)`. Each call also
   * needs a matching, mission-earned Training Credit; this helper only computes
   * the token input and never implies that tokens alone can train a citizen.
   */
  trainingCostAtoms(currentScore: number): bigint {
    return trainingCostAtoms(this.config.baseTrainingCostAtoms, currentScore);
  }

  /** Throw unless the client is talking to the expected cluster. */
  assertNetwork(expected: SupportedNetwork): void {
    if (this.config.cluster !== expected) {
      throw new DistrictClientError(
        `client is configured for "${this.config.cluster}" but "${expected}" is required`,
      );
    }
  }
}
