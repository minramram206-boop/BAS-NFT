/**
 * Shared configuration for one Solana cluster.
 *
 * The manifest names follow `docs/specs/BAS_DISTRICT_SPEC_V2_ID.md` §4.3 so
 * the deployment files and the product specification can be compared without
 * an adapter or a second set of aliases. `baseTrainingCostAtoms` stays a
 * decimal string: token atoms are integers, and JSON numbers cannot safely
 * represent the full on-chain `u64` range.
 *
 * `rpcUrl`, `maxSupply`, `approvedTemplateId`, `approvedTemplateUriPrefix` and
 * `tokenDecimals` are local manifest additions: the app needs an endpoint and a
 * mock supply for preview, the program needs an immutable approved metadata
 * template id and URI prefix (§6.3), and the client needs decimals to render
 * atoms as tokens. These values are present in both
 * manifests; behavior-affecting release values still have to match across
 * devnet and mainnet (§4.3).
 */
export interface DistrictNetworkConfig {
  /** Solana cluster name. The same spelling selects the client config. */
  cluster: SupportedNetwork;
  /** RPC endpoint; only the endpoint may differ between network configs. */
  rpcUrl: string;
  /** Anchor district program id (`districtProgramId` in SPEC §4.3). */
  districtProgramId: string;
  /**
   * Fixed-price market program (`programs/market`, docs/MARKET.md). Only on
   * devnet until an external audit; a cluster without it has no market.
   */
  marketProgramId?: string;
  /**
   * `devnet-fast` when the deployed market was built with its `devnet-clock`
   * feature: auctions run in minutes instead of days, so they can be tested to
   * the end. Absent means the real clock. Never allowed on mainnet, and
   * `scripts/devnet/deploy.sh` refuses a binary that disagrees with it.
   */
  auctionClock?: 'devnet-fast';
  /**
   * Season prize vault program (`programs/prize_vault`, docs/PRIZE_VAULT.md,
   * D-0019). A cluster without it shows the season with no vault yet.
   */
  prizeVaultProgramId?: string;
  /**
   * `devnet-fast` when the deployed prize vault was built with its
   * `devnet-clock` feature: the dispute window lasts 8 minutes instead of
   * 48 hours. Devnet only, like `auctionClock`.
   */
  prizeClock?: 'devnet-fast';
  /** Official Metaplex Core collection (`coreCollection` in SPEC §4.3). */
  coreCollection: string;
  /** Metaplex Core Candy Machine address. */
  candyMachine: string;
  /** Candy Guard paired with the Candy Machine. */
  candyGuard: string;
  /** Official token mint (Pump.fun on mainnet, behaviorally equivalent mirror on devnet). */
  utilityTokenMint: string;
  /** SOL mint-payment treasury (`solTreasury` in SPEC §4.3). */
  solTreasury: string;
  /** Core royalty recipient (`royaltyRecipient` in SPEC §4.3). */
  royaltyRecipient: string;
  /** Authority key allowed to approve mission claims. */
  missionAuthority: string;
  /**
   * Backend key named by the Candy Guard `thirdPartySigner` guard. The mission
   * server co-signs a mint only after it checked the sale state, so the public
   * mint cannot be sent straight to the Candy Machine around the app.
   * It signs mints and nothing else: it holds no authority over the program.
   */
  mintSigner: string;
  /** Maximum citizen score (SPEC §7: 10). */
  maxScore: number;
  /** Base training cost, in token atoms. See formula in SPEC §5.3. */
  baseTrainingCostAtoms: string;
  /** Burn share in basis points (SPEC §5.3: 10000 = 100%). */
  burnBps: number;
  /** Daily chat quota (SPEC §12 config example). */
  dailyMessageLimit: number;
  /** Token decimals; devnet mirror must match mainnet (§5.1). */
  tokenDecimals: number;
  /** Immutable metadata-template id verified during Core asset registration (§6.3 item 3). */
  approvedTemplateId: number;
  /** HTTPS allowlist prefix ending in `/templates/{approvedTemplateId}/`. */
  approvedTemplateUriPrefix: string;
  /** Mock collection supply for UI preview; the Candy Machine enforces live supply. */
  maxSupply: number;
  /**
   * Public mint price in lamports, charged by the Candy Guard `solPayment`
   * guard and paid to `solTreasury` (D-0024). `10000000` is 0.01 SOL.
   */
  mintPriceLamports: string;
  /**
   * How many citizens one wallet can mint in the public sale, enforced by the
   * Candy Guard `mintLimit` guard (D-0055). The collection is small and its
   * roles are scarce, so a wallet cannot hold a whole role from the sale.
   */
  mintLimitPerWallet: number;
}

export type SupportedNetwork = 'devnet' | 'mainnet-beta';

/** Parsed JSON object before runtime validation narrows any of its values. */
export type NetworkConfigFile = Record<keyof DistrictNetworkConfig, unknown>;
