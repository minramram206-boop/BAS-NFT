import type { CitizenRecord, StatKey } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import type {
  DistrictSnapshot,
  HistoryEntry,
  LeaderboardEntry,
  MissionDefinition,
  StatCredits,
} from '../types';

/**
 * The mock district: one wallet that owns three citizens on day 12 of
 * season 1. Every number follows the program rules, so the history of an
 * owned citizen adds up to its scores and burned tokens.
 */

type Scores = Readonly<Record<StatKey, number>>;

const SCORES: Readonly<Record<number, Scores>> = {
  1: { intelligence: 1, alignment: 2, compute: 4 },
  2: { intelligence: 6, alignment: 1, compute: 1 },
  3: { intelligence: 2, alignment: 4, compute: 1 },
  4: { intelligence: 0, alignment: 3, compute: 1 },
  8: { intelligence: 2, alignment: 1, compute: 5 },
  11: { intelligence: 0, alignment: 2, compute: 6 },
  12: { intelligence: 2, alignment: 1, compute: 4 },
  13: { intelligence: 1, alignment: 3, compute: 5 },
  18: { intelligence: 6, alignment: 1, compute: 3 },
  19: { intelligence: 1, alignment: 5, compute: 0 },
};

const OWNED = [1, 2, 4] as const;
const FOUNDING = [1, 2, 3, 4, 8] as const;

const CREDITS: Readonly<Record<number, StatCredits>> = {
  1: { intelligence: 0, alignment: 1, compute: 2 },
  2: { intelligence: 1, alignment: 0, compute: 0 },
  4: { intelligence: 0, alignment: 1, compute: 1 },
};

const NO_CREDITS: StatCredits = { intelligence: 0, alignment: 0, compute: 0 };

export const MOCK_MISSIONS: readonly MissionDefinition[] = [
  {
    id: 'streetLamp',
    district: 'forge',
    rewards: ['compute'],
    steps: [{ kind: 'goto', cell: [10, 10] }, { kind: 'goto', cell: [17, 8] }, { kind: 'puzzle' }],
  },
  {
    id: 'lightsOut',
    district: 'archive',
    rewards: ['intelligence'],
    steps: [{ kind: 'goto', cell: [8, 8] }, { kind: 'talk', answer: 1 }, { kind: 'talk', answer: 2 }],
  },
  {
    id: 'hearthDeliveries',
    district: 'hearth',
    rewards: ['alignment'],
    steps: [{ kind: 'goto', cell: [13, 10] }, { kind: 'goto', cell: [6, 16] }, { kind: 'talk', answer: 0 }],
  },
  {
    id: 'nightPatrol',
    district: 'watch',
    rewards: ['alignment', 'compute'],
    steps: [
      { kind: 'goto', cell: [20, 14] },
      { kind: 'goto', cell: [22, 16] },
      { kind: 'goto', cell: [18, 19] },
      { kind: 'talk', answer: 2 },
    ],
  },
  {
    id: 'ruinsExpedition',
    district: 'frontier',
    rewards: ['intelligence', 'compute'],
    steps: [
      { kind: 'goto', cell: [12, 13] },
      { kind: 'goto', cell: [21, 19] },
      { kind: 'goto', cell: [23, 23] },
      { kind: 'puzzle' },
    ],
  },
  {
    id: 'blackoutNight',
    district: 'plaza',
    rewards: ['intelligence', 'alignment', 'compute'],
    steps: [{ kind: 'puzzle' }, { kind: 'talk', answer: 1 }, { kind: 'talk', answer: 0 }],
    opensInHours: 52,
  },
];

/** Training steps an owned citizen took, oldest first, as `[day, stat]`. */
const TRAINING: Readonly<Record<number, readonly (readonly [number, StatKey])[]>> = {
  1: [
    [3, 'intelligence'],
    [5, 'alignment'],
    [7, 'compute'],
    [11, 'compute'],
  ],
  2: [
    [2, 'compute'],
    [4, 'intelligence'],
    [6, 'intelligence'],
    [8, 'intelligence'],
    [10, 'intelligence'],
  ],
  4: [[6, 'alignment']],
};

/**
 * Missions finished, as `[day, missionId, stat]`. Each training step above
 * spends a credit earned here on an earlier day, and what is left over is
 * exactly `CREDITS`.
 */
const MISSIONS_DONE: Readonly<Record<number, readonly (readonly [number, string, StatKey])[]>> = {
  1: [
    [1, 'lightsOut', 'intelligence'],
    [2, 'hearthDeliveries', 'alignment'],
    [4, 'streetLamp', 'compute'],
    [6, 'streetLamp', 'compute'],
    [8, 'hearthDeliveries', 'alignment'],
    [9, 'streetLamp', 'compute'],
    [10, 'streetLamp', 'compute'],
  ],
  2: [
    [1, 'streetLamp', 'compute'],
    [3, 'lightsOut', 'intelligence'],
    [5, 'lightsOut', 'intelligence'],
    [7, 'lightsOut', 'intelligence'],
    [9, 'lightsOut', 'intelligence'],
    [11, 'lightsOut', 'intelligence'],
  ],
  4: [
    [3, 'hearthDeliveries', 'alignment'],
    [5, 'streetLamp', 'compute'],
    [8, 'nightPatrol', 'alignment'],
  ],
};

function historyOf(citizen: CitizenRecord, start: Scores, baseTrainingCostAtoms: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [{ day: 1, kind: 'register' }];
  const current: Record<StatKey, number> = { ...start };
  for (const [day, stat] of TRAINING[citizen.id] ?? []) {
    entries.push({
      day,
      kind: 'train',
      stat,
      from: current[stat],
      burnedAtoms: trainingCostAtoms(baseTrainingCostAtoms, current[stat]),
    });
    current[stat] += 1;
  }
  for (const [day, missionId, stat] of MISSIONS_DONE[citizen.id] ?? []) {
    entries.push({ day, kind: 'mission', missionId, stat });
  }
  return entries.sort((a, b) => b.day - a.day);
}

function leaderboard(): readonly LeaderboardEntry[] {
  const rows: readonly (readonly [number | null, string, CitizenRecord['roleKey'], number])[] = [
    [18, '#018', 'navigator', 1420],
    [11, '#011', 'artisan', 1310],
    [13, '#013', 'artisan', 1190],
    [19, '#019', 'steward', 1040],
    [1, '#001', 'artisan', 985],
    [12, '#012', 'pioneer', 930],
    [8, '#008', 'mentor', 870],
    [3, '#003', 'steward', 845],
    [null, '#031', 'scholar', 790],
  ];
  return rows.map(([citizenId, serial, roleKey, points]) => ({ citizenId, serial, roleKey, points }));
}

export function createMockSnapshot(
  roster: readonly CitizenRecord[],
  baseTrainingCostAtoms: string,
): DistrictSnapshot {
  const citizens = roster.map((citizen) => {
    const scores = SCORES[citizen.id];
    return scores ? { ...citizen, ...scores, registered: true } : { ...citizen };
  });

  const history: Record<number, HistoryEntry[]> = {};
  for (const id of OWNED) {
    const base = roster.find((citizen) => citizen.id === id);
    if (base) history[id] = historyOf(base, base, baseTrainingCostAtoms);
  }

  const credits: Record<number, StatCredits> = {};
  for (const citizen of citizens) credits[citizen.id] = CREDITS[citizen.id] ?? NO_CREDITS;

  return {
    wallet: { label: '7xQ4…9fA', tokenAtoms: 1_240_000_000n },
    citizens,
    credits,
    owned: OWNED.filter((id) => citizens.some((citizen) => citizen.id === id)),
    founding: [...FOUNDING],
    history,
    missions: MOCK_MISSIONS,
    missionProgress: { streetLamp: { citizenId: 1, done: 1, stat: 'compute' } },
    season: {
      number: 1,
      day: 12,
      length: 28,
      vaultLamports: 18_420_000_000n,
      fundedLamports: 6_000_000_000n,
      vaultAddress: 'PZv4…k2Q8',
      pools: [
        { id: 'open', shareBps: 3000, maxWinners: 10, validEntries: 64 },
        { id: 'rookie', shareBps: 1000, maxWinners: 10, validEntries: 51 },
        { id: 'skilled', shareBps: 1500, maxWinners: 7, validEntries: 38 },
        { id: 'elite', shareBps: 2000, maxWinners: 5, validEntries: 12 },
        { id: 'master', shareBps: 2500, maxWinners: 3, validEntries: 0 },
      ],
      leaderboards: { skilled: leaderboard() },
    },
  };
}
