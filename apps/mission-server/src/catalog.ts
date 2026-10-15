/**
 * The mission catalog the server enforces (D-0025).
 *
 * The web app ships the same structure for display, but without the answers.
 * `apps/web/test/missionParity.test.ts` fails when the two drift apart, so a
 * mission cannot be changed on one side only.
 *
 * `chainId` is the `mission_id` written into the claim receipt PDA. It must
 * never change or be reused: a different id for the same mission would let a
 * citizen claim it again.
 */

export type StatName = 'intelligence' | 'alignment' | 'compute';

export type DistrictId = 'plaza' | 'archive' | 'hearth' | 'forge' | 'watch' | 'frontier' | 'summit';

export type MissionStepSpec =
  /** Walk the citizen to this map cell. */
  | { readonly kind: 'goto'; readonly cell: readonly [number, number] }
  /** Pick one of `options` replies; `answer` is the index of the right one. */
  | { readonly kind: 'talk'; readonly options: number; readonly answer: number }
  /** Put `pieces` pieces in order; the right order is `0, 1, 2, ...`. */
  | { readonly kind: 'puzzle'; readonly pieces: number };

export interface MissionSpec {
  /** Key of the mission in the web copy catalog. */
  readonly id: string;
  /** `mission_id` in the claim receipt. */
  readonly chainId: number;
  readonly district: DistrictId;
  /** Stats the credit can be for; the player picks one at start. */
  readonly rewards: readonly StatName[];
  readonly steps: readonly MissionStepSpec[];
  /** Event missions can only be started inside a scheduled window. */
  readonly event?: true;
}

const ALL_STATS: readonly StatName[] = ['intelligence', 'alignment', 'compute'];

export const MISSIONS: readonly MissionSpec[] = [
  {
    id: 'streetLamp',
    chainId: 1,
    district: 'forge',
    rewards: ['compute'],
    steps: [{ kind: 'goto', cell: [18, 18] }, { kind: 'goto', cell: [25, 16] }, { kind: 'puzzle', pieces: 4 }],
  },
  {
    id: 'lightsOut',
    chainId: 2,
    district: 'archive',
    rewards: ['intelligence'],
    steps: [
      { kind: 'goto', cell: [16, 16] },
      { kind: 'talk', options: 3, answer: 1 },
      { kind: 'talk', options: 3, answer: 2 },
    ],
  },
  {
    id: 'hearthDeliveries',
    chainId: 3,
    district: 'hearth',
    rewards: ['alignment'],
    steps: [{ kind: 'goto', cell: [21, 18] }, { kind: 'goto', cell: [14, 24] }, { kind: 'talk', options: 3, answer: 0 }],
  },
  {
    id: 'nightPatrol',
    chainId: 4,
    district: 'watch',
    rewards: ['alignment', 'compute'],
    steps: [
      { kind: 'goto', cell: [28, 22] },
      { kind: 'goto', cell: [30, 24] },
      { kind: 'goto', cell: [26, 27] },
      { kind: 'talk', options: 3, answer: 2 },
    ],
  },
  {
    id: 'ruinsExpedition',
    chainId: 5,
    district: 'frontier',
    rewards: ['intelligence', 'compute'],
    steps: [
      { kind: 'goto', cell: [20, 21] },
      { kind: 'goto', cell: [29, 27] },
      { kind: 'goto', cell: [31, 31] },
      { kind: 'puzzle', pieces: 4 },
    ],
  },
  {
    id: 'blackoutNight',
    chainId: 6,
    district: 'plaza',
    rewards: ALL_STATS,
    steps: [
      { kind: 'puzzle', pieces: 3 },
      { kind: 'talk', options: 3, answer: 1 },
      { kind: 'talk', options: 3, answer: 0 },
    ],
    event: true,
  },
  {
    id: 'summitTrial',
    chainId: 7,
    district: 'summit',
    rewards: ALL_STATS,
    steps: [
      { kind: 'goto', cell: [9, 0] },
      { kind: 'goto', cell: [4, 0] },
      { kind: 'talk', options: 3, answer: 1 },
      { kind: 'puzzle', pieces: 3 },
    ],
  },
];

/** Stats a district belongs to and the score one of them must reach to enter. */
export const DISTRICT_UNLOCK: Readonly<Record<DistrictId, { stats: readonly StatName[]; score: 0 | 3 | 6 | 10 }>> = {
  plaza: { stats: ALL_STATS, score: 0 },
  archive: { stats: ['intelligence'], score: 0 },
  hearth: { stats: ['alignment'], score: 0 },
  forge: { stats: ['compute'], score: 0 },
  watch: { stats: ['alignment', 'compute'], score: 3 },
  frontier: { stats: ['intelligence', 'compute'], score: 6 },
  summit: { stats: ALL_STATS, score: 10 },
};

export function findMission(id: string): MissionSpec | undefined {
  return MISSIONS.find((mission) => mission.id === id);
}

export function findMissionByChainId(chainId: number): MissionSpec | undefined {
  return MISSIONS.find((mission) => mission.chainId === chainId);
}

/** Scores of a citizen as read from the chain. */
export type StatScores = Readonly<Record<StatName, number>>;

export function isDistrictOpen(scores: StatScores, district: DistrictId): boolean {
  const rule = DISTRICT_UNLOCK[district];
  return rule.score === 0 || rule.stats.some((stat) => scores[stat] >= rule.score);
}

/** Missions per citizen per season day, and points per finished mission (D-0025). */
export const DAILY_MISSION_LIMIT = 3;
export const MISSION_POINTS = 100;
export const EVENT_TASK_POINTS = 150;
