import type { StoreApi } from 'zustand';
import type { CitizenRecord, StatKey } from '@bas/content';
import type { WalletSession } from '@/lib/data/chain/types';
import type { ChatAnimation, ChatEmotion } from '@/lib/data/chat';
import type {
  DistrictActionError,
  DistrictDataSource,
  DistrictSnapshot,
  MissionDefinition,
  StepProof,
} from '@/lib/data/types';

/**
 * Shape of the BAS District presentation store.
 *
 * Every read and write goes through one `DistrictDataSource` (D-0020). In
 * mock mode nothing becomes chain state and no transaction is sent.
 */

/** How a step ended: done, answered wrongly, or stopped for another reason. */
export type StepOutcome = 'ok' | 'wrong' | 'refused';

/** What a finished mission paid out, shown in the reward popup. */
export interface MissionReward {
  citizenName: string;
  missionId: string;
  stat: StatKey;
  points: number;
  /** Credits of `stat` the citizen holds after this mission. */
  creditsReady: number;
  /** Missions the citizen can still start today. */
  leftToday: number;
}

export interface ModalState {
  isOpen: boolean;
  title: string;
  message: string;
}

/** Values read from the selected cluster manifest. */
export interface TrainingConfig {
  baseTrainingCostAtoms: string;
  tokenDecimals: number;
  tokenSymbol: string;
}

export interface DistrictSlice extends Omit<DistrictSnapshot, 'citizens'> {
  /** Kept mutable for the existing selectors; replaced whole on every change. */
  citizens: CitizenRecord[];
  source: DistrictDataSource;
  trainingConfig: TrainingConfig;
  selectedCitizenId: number;
  /** True while a data-source call is running. */
  busy: boolean;
  /** Result of the last action, shown by the screen that started it. */
  lastError: DistrictActionError | null;
  selectCitizen: (id: number) => void;
  /**
   * The citizen last tapped in the city, so a wallet without a citizen of its
   * own can see who that is and make an offer. `null` once the card is closed.
   */
  cityPick: number | null;
  pickFromCity: (id: number | null) => void;
  /** Mint one citizen and select it; resolves to its id, or `null` when the mint was refused. */
  mintCitizen: () => Promise<number | null>;
  trainStat: (stat: StatKey, targetElement?: HTMLElement | null) => Promise<boolean>;
  startMission: (mission: MissionDefinition, stat: StatKey) => Promise<boolean>;
  /**
   * Finish the current step. `wrong` means the answer was refused and the step is still open;
   * `refused` means something else stopped it and the player was told why.
   */
  advanceMission: (mission: MissionDefinition, proof: StepProof) => Promise<StepOutcome>;
  /** Mock only: one day forward, to try the daily mission limits. */
  nextDay: () => Promise<void>;
  /** Chain only: the wallet the person connected, or `null` after a disconnect. Reads the district for it. */
  connectWallet: (session: WalletSession | null) => Promise<void>;
  /** Chain only: read the cluster and the mission server again, without bothering the person on failure. */
  refreshData: () => Promise<void>;
  abandonMission: (missionId: string) => Promise<void>;
  /** Offer an owned citizen for a fixed price; resolves to whether the listing was made. */
  listCitizen: (citizenId: number, priceLamports: bigint) => Promise<boolean>;
  changeListingPrice: (citizenId: number, priceLamports: bigint) => Promise<boolean>;
  cancelListing: (citizenId: number) => Promise<boolean>;
  /** Buy a listed citizen and select it; resolves to whether the purchase went through. */
  buyCitizen: (citizenId: number) => Promise<boolean>;
  /** Mock only: let another player buy one of the wallet's listings. */
  simulateSale: (citizenId: number) => Promise<void>;
  /** Put an owned citizen up for auction for `durationHours`; resolves to whether it started. */
  auctionCitizen: (citizenId: number, startPriceLamports: bigint, durationHours: number) => Promise<boolean>;
  placeBid: (citizenId: number, amountLamports: bigint) => Promise<boolean>;
  cancelAuction: (citizenId: number) => Promise<boolean>;
  /** Finish an ended auction and say how it went; selects the citizen when the wallet won it. */
  settleAuction: (citizenId: number) => Promise<boolean>;
  /** Mock only: another player bids the least the auction takes. */
  simulateBid: (citizenId: number) => Promise<void>;
  /** Mock only: jump to the end of an auction. */
  simulateAuctionEnd: (citizenId: number) => Promise<void>;
  /** Offer on a citizen the wallet does not own, open for `days`; replaces the wallet's earlier offer on it. */
  makeOffer: (citizenId: number, amountLamports: bigint, days: number) => Promise<boolean>;
  withdrawOffer: (citizenId: number) => Promise<boolean>;
  /** Sell an owned citizen to one offer; resolves to whether the sale went through. */
  acceptOffer: (citizenId: number, offerId: string) => Promise<boolean>;
  /** Mock only: another player makes an offer on one of the wallet's citizens. */
  simulateOffer: (citizenId: number) => Promise<void>;
  /** Mock only: the owner accepts the wallet's offer. */
  simulateOfferAccepted: (citizenId: number) => Promise<void>;
  clearError: () => void;
}

export type CityMode = 'auto' | 'control';

export interface CitySlice {
  cityMode: CityMode;
  /** Bumped to ask the scene to zoom; the sign is the direction. */
  zoomRequest: { id: number; step: 1 | -1 };
  /** Bumped to ask the scene to center on the selected citizen. */
  focusRequest: number;
  /** Bumped to ask the scene to walk the mission citizen to the current stop. */
  walkRequest: number;
  setCityMode: (mode: CityMode) => void;
  requestZoom: (step: 1 | -1) => void;
  requestFocus: () => void;
  requestWalk: () => void;
}

export interface UiSlice {
  /**
   * Where a next-step button sent the player. The screen it opens reads the value
   * once to pre-select that stat or mission and then clears it.
   */
  focus: { training: StatKey | null; mission: string | null };
  setFocus: (focus: Partial<UiSlice['focus']>) => void;
  /**
   * The mission popup of the city. `dismissed` is the step the player closed, so it is
   * not opened again; `arrived` is the step the citizen just walked to.
   */
  missionPrompt: { dismissed: string | null; arrived: string | null };
  dismissMissionPrompt: (stepKey: string) => void;
  reopenMissionPrompt: () => void;
  markMissionArrival: (stepKey: string) => void;
  reward: MissionReward | null;
  closeReward: () => void;
  sfxEnabled: boolean;
  modal: ModalState;
  /** The wallet picker is open (chain mode). */
  walletDialog: boolean;
  /** Chain mode opens the wallet picker; the mock preview explains that its wallet is not real. */
  openWallet: () => void;
  closeWalletDialog: () => void;
  toggleSfx: () => void;
  openModal: (title: string, message: string) => void;
  closeModal: () => void;
}

/** One line of a conversation as the screen shows it. A `notice` is the app speaking, not the citizen. */
export interface ChatLine {
  id: number;
  from: 'owner' | 'citizen' | 'notice';
  text: string;
  emotion?: ChatEmotion;
}

/** The latest animation a citizen's reply asked for. `nonce` changes on every reply, so the same animation can play twice in a row. */
export interface CitizenReaction {
  animation: ChatAnimation;
  /** Shown as a short label on the portrait, so the mood is readable even when motion is turned off. */
  emotion: ChatEmotion;
  nonce: number;
}

export interface ChatSlice {
  chatLogs: Readonly<Record<number, readonly ChatLine[]>>;
  reactions: Readonly<Record<number, CitizenReaction>>;
  react: (citizenId: number, animation: ChatAnimation, emotion: ChatEmotion) => void;
  /** Adds a line and returns its id. */
  addChatLine: (citizenId: number, line: Omit<ChatLine, 'id'>) => number;
  removeChatLine: (citizenId: number, id: number) => void;
  clearChatLog: (citizenId: number) => void;
  /** Forgets every line and reaction on screen, for when another wallet takes over the browser. */
  resetChat: () => void;
}

export type BasStore = DistrictSlice & CitySlice & UiSlice & ChatSlice;

export interface CreateBasStoreOptions {
  /** Validated roster produced by `@bas/content/server`. */
  citizens: readonly CitizenRecord[];
  /** Configured cost inputs. */
  trainingConfig: TrainingConfig;
  /** `mintPriceLamports` from the cluster manifest, a decimal string. */
  mintPriceLamports: string;
  /** Citizens one wallet can mint, from the manifest. */
  mintLimitPerWallet: number;
  /** Present when the district runs on a cluster instead of the mock data. */
  chain?: ChainOptions;
}

/** Where the chain data source reads and which server it plays missions with. */
export interface ChainOptions {
  /** Cluster the wallet must be set to. */
  cluster: 'devnet' | 'mainnet-beta';
  rpcUrl: string;
  programId: string;
  /** Official Core collection. */
  collection: string;
  /** Core Candy Machine of the public sale. */
  candyMachine: string;
  utilityMint: string;
  /** The market program; without it the market stays closed. */
  marketProgramId?: string;
  /** The manifest's `auctionClock`: set when the deployed market runs auctions in minutes. */
  auctionClock?: 'devnet-fast';
  maxSupply: number;
  /** Origin of the mission server. */
  missionServerUrl: string;
  /** Origin of the chat server. */
  chatServerUrl: string;
}

export type SetState = StoreApi<BasStore>['setState'];
export type GetState = StoreApi<BasStore>['getState'];
