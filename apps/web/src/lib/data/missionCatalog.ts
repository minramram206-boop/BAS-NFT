import type { MissionDefinition } from './types';

/**
 * The missions every data source lists, with their steps and rewards but
 * without the answers. The mission server keeps the same structure together
 * with the answer keys; `test/missionParity.test.ts` fails when they differ.
 * Event missions are listed here too: when they open comes from the source.
 */
export const MISSION_CATALOG: readonly MissionDefinition[] = [
  {
    id: 'streetLamp',
    district: 'forge',
    rewards: ['compute'],
    steps: [{ kind: 'goto', cell: [18, 18] }, { kind: 'goto', cell: [25, 16] }, { kind: 'puzzle' }],
  },
  {
    id: 'lightsOut',
    district: 'archive',
    rewards: ['intelligence'],
    steps: [{ kind: 'goto', cell: [16, 16] }, { kind: 'talk' }, { kind: 'talk' }],
  },
  {
    id: 'hearthDeliveries',
    district: 'hearth',
    rewards: ['alignment'],
    steps: [{ kind: 'goto', cell: [21, 18] }, { kind: 'goto', cell: [14, 24] }, { kind: 'talk' }],
  },
  {
    id: 'nightPatrol',
    district: 'watch',
    rewards: ['alignment', 'compute'],
    steps: [
      { kind: 'goto', cell: [28, 22] },
      { kind: 'goto', cell: [30, 24] },
      { kind: 'goto', cell: [26, 27] },
      { kind: 'talk' },
    ],
  },
  {
    id: 'ruinsExpedition',
    district: 'frontier',
    rewards: ['intelligence', 'compute'],
    steps: [
      { kind: 'goto', cell: [20, 21] },
      { kind: 'goto', cell: [29, 27] },
      { kind: 'goto', cell: [31, 31] },
      { kind: 'puzzle' },
    ],
  },
  {
    id: 'blackoutNight',
    district: 'plaza',
    rewards: ['intelligence', 'alignment', 'compute'],
    steps: [{ kind: 'puzzle' }, { kind: 'talk' }, { kind: 'talk' }],
    event: true,
  },
  {
    id: 'summitTrial',
    district: 'summit',
    rewards: ['intelligence', 'alignment', 'compute'],
    steps: [{ kind: 'goto', cell: [9, 0] }, { kind: 'goto', cell: [4, 0] }, { kind: 'talk' }, { kind: 'puzzle' }],
  },
];
