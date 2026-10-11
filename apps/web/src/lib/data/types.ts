import type { CitizenRecord, StatKey } from '@bas/content';

/**
 * View model of the district, shared by every data source (D-0020).
 *
 * Scores and credits mirror `CitizenState` in `programs/district`, so a screen
 * built on the mock source keeps working when the chain source replaces it.
 * Copy is never stored here: entries carry ids and numbers, and the screens
 * render them through `src/messages/en.json`.
 */

export type DistrictId = 'plaza' | 'archive' | 'hearth' | 'forge' | 'watch' | 'frontier' | 'summit';

export type StatCredits = Readonly<Record<StatKey, number>>;

export type HistoryEntry =
  | { readonly day: number; readonly kind: 'register' }
  | {
      readonly day: number;
      readonly kind: 'train';
      readonly stat: StatKey;
      readonly from: number;
      readonly burnedAtoms: bigint;
    }
  | {
      readonly day: number;
      readonly kind: 'mission';
      readonly missionId: string;
      readonly stat: StatKey;
    };

/**
 * One step of a mission (D-0025). The copy for each step lives at the same
 * index in `messages.missions.catalog.<id>.steps`.
 */
export type MissionStep =
  /** Walk the citizen to this cell `[gx, gy]` on the map. */
  | { readonly kind: 'goto'; readonly cell: readonly [number, number] }
  /** Pick one of three replies; `answer` is the index of the right one. */
  | { readonly kind: 'talk'; readonly answer: number }
  /** Put the step's pieces back in the order they are listed in the copy. */
  | { readonly kind: 'puzzle' };

export interface MissionDefinition {
  /** Key of the mission copy in `messages.missions.catalog`. */
  readonly id: string;
  readonly district: DistrictId;
  /** Stats the credit can be for; with more than one the player picks at start. */
  readonly rewards: readonly StatKey[];
  readonly steps: readonly MissionStep[];
  /** A district event opens later and cannot be started yet. */
  readonly opensInHours?: number;
}

export interface MissionProgress {
  readonly citizenId: number;
  /** Steps finished so far, `0` right after starting. */
  readonly done: number;
  /** The stat the credit will be for, fixed when the mission starts. */
  readonly stat: StatKey;
}

export type BracketId = 'open' | 'rookie' | 'skilled' | 'elite' | 'master';

export interface LeaderboardEntry {
  /** A citizen from the roster, or `null` for one outside this preview. */
  readonly citizenId: number | null;
  /** Public serial, used when the citizen is not in the roster. */
  readonly serial: string;
  readonly roleKey: CitizenRecord['roleKey'];
  readonly points: number;
}

export interface BracketPool {
  readonly id: BracketId;
  /** Share of the season pool in basis points. */
  readonly shareBps: number;
  readonly maxWinners: number;
  readonly validEntries: number;
}

export interface SeasonSnapshot {
  readonly number: number;
  readonly day: number;
  readonly length: number;
  /** Lamports in the prize vault PDA. */
  readonly vaultLamports: bigint;
  /** Lamports set aside for this season by `fund_season`. */
  readonly fundedLamports: bigint;
  readonly vaultAddress: string;
  readonly pools: readonly BracketPool[];
  readonly leaderboards: Readonly<Partial<Record<BracketId, readonly LeaderboardEntry[]>>>;
}

export interface WalletView {
  /** Shortened address shown in the header. */
  readonly label: string;
  /** Utility token balance in atoms. */
  readonly tokenAtoms: bigint;
}

export interface DistrictSnapshot {
  readonly wallet: WalletView;
  /** Roster with canonical scores in `intelligence`, `alignment` and `compute`. */
  readonly citizens: readonly CitizenRecord[];
  readonly credits: Readonly<Record<number, StatCredits>>;
  readonly owned: readonly number[];
  readonly founding: readonly number[];
  readonly history: Readonly<Record<number, readonly HistoryEntry[]>>;
  readonly missions: readonly MissionDefinition[];
  readonly missionProgress: Readonly<Record<string, MissionProgress>>;
  readonly season: SeasonSnapshot;
}

export type DistrictActionError =
  | 'not-owner'
  | 'stat-at-max'
  | 'no-credit'
  | 'insufficient-balance'
  | 'district-locked'
  | 'mission-busy'
  | 'mission-closed'
  | 'citizen-busy'
  | 'mission-cooldown'
  | 'daily-limit'
  | 'invalid-stat';

export type DistrictActionResult =
  | { readonly ok: true; readonly snapshot: DistrictSnapshot }
  | { readonly ok: false; readonly error: DistrictActionError };

/**
 * The one door every screen uses to read and change district data (D-0020).
 * `mock` runs the program rules locally; `chain` will send transactions.
 */
export interface DistrictDataSource {
  readonly mode: 'mock' | 'chain';
  snapshot(): DistrictSnapshot;
  /** `upgrade_score`: spend one credit and burn the training cost. */
  upgradeScore(citizenId: number, stat: StatKey): Promise<DistrictActionResult>;
  /** Take a mission with one citizen; `stat` must be one of the mission's rewards. */
  startMission(citizenId: number, missionId: string, stat: StatKey): Promise<DistrictActionResult>;
  /** Finish the current step; the last one grants the credit (`claim_training_credit`). */
  advanceMission(citizenId: number, missionId: string): Promise<DistrictActionResult>;
  abandonMission(missionId: string): Promise<DistrictActionResult>;
  /** Mock only: move the season clock one day forward to try the daily limits. */
  nextDay?(): Promise<DistrictActionResult>;
}
