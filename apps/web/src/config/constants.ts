import { MAX_STAT_SCORE, STAT_KEYS } from '@bas/content';
import type { StatKey } from '@bas/content';

/**
 * Presentation constants and copy for the District 01 shell.
 * Keeping them in one module stops the same strings, numbers and colours from
 * being re-typed in every component.
 *
 * This module runs in the browser, so it must not import Node-only packages.
 * Values that mirror the on-chain protocol are verified by
 * `packages/chain-client/test/chain-client.test.ts`.
 */

/** Maximum score of a citizen stat, mirrored from `programs/district`. */
export { MAX_STAT_SCORE };

/** Trainable stats in display order. */
export const STAT_ORDER: readonly StatKey[] = STAT_KEYS;

/** Number of stat blocks rendered by a meter. */
export const STAT_METER_SEGMENTS = 5;

/** Citizens displayed per registry page (3x3 grid). */
export const REGISTRY_PAGE_SIZE = 9;

/**
 * Remaining slots shown by the mock header before any mint.
 *
 * The configured collection size comes from `config/<network>.json` and is
 * exposed as `DistrictTelemetry.maxSupply`; this value is only the starting
 * point of the client-side session counter until the program is wired up.
 */
export const INITIAL_SUPPLY_COUNT = 100;

/** DOM id of the registry section, used by the "LIHAT WARGA" action. */
export const REGISTRY_SECTION_ID = 'citizen-registry-section';

/** Movement tuning of the 2.5D plaza stage, in stage pixel units. */
export const STAGE = {
  width: 276,
  height: 224,
  backgroundImage: '/images/district/courtyard_stage_bg.png',
  startPosition: { x: 82, y: 92 },
  walkStep: 10,
  verticalScale: 0.6,
  bounds: { minX: 70, maxX: 215, minY: 105, maxY: 172 },
  lerpFactor: 0.25,
  frameIntervalMs: 1000 / 60,
  arriveThreshold: 1,
} as const;

/** Keyboard bindings accepted while walking the plaza. */
export const STAGE_MOVE_KEYS = {
  left: ['ArrowLeft', 'a', 'A'],
  right: ['ArrowRight', 'd', 'D'],
  up: ['ArrowUp', 'w', 'W'],
  down: ['ArrowDown', 's', 'S'],
} as const;

/** Key that returns from the dojo to the district. */
export const BACK_TO_DISTRICT_HOTKEY = '3';

export interface StatMeta {
  /** Full stat name as shown on cards. */
  label: string;
  /** Three letter abbreviation used in buttons and badges. */
  shortLabel: string;
  /** Header of the large dojo drill button. */
  actionLabel: string;
  emoji: string;
  /** Emoji used by the dojo attribute list, when it differs from `emoji`. */
  dojoEmoji?: string | undefined;
  /** Meter value colour. */
  meterColorClass: string;
  /** Attribute row accent colour. */
  valueColorClass: string;
  /** Gradient of the large dojo drill button. */
  actionButtonClass: string;
  /** Subtitle colour of the large dojo drill button. */
  actionHintClass: string;
  /**
   * Keyboard shortcut of the dojo drill.
   * Only the stats that the dojo exposes as a drill have a hotkey; the
   * remaining key returns to the district.
   */
  hotkey?: string | undefined;
}

export const STAT_META: Record<StatKey, StatMeta> = {
  intelligence: {
    label: 'INTELLIGENCE (INT)',
    shortLabel: 'INT',
    actionLabel: 'LATIH INTELLIGENCE',
    emoji: '📖',
    meterColorClass: 'bg-[#3c76ad]',
    valueColorClass: 'text-[#286396]',
    actionButtonClass:
      'bg-gradient-to-b from-[#5588b9] via-[#4374a3] to-[#33618d] border-[#183248] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#183248] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]',
    actionHintClass: 'text-sky-200',
    hotkey: '1',
  },
  alignment: {
    label: 'ALIGNMENT (ALN)',
    shortLabel: 'ALN',
    actionLabel: 'LATIH ALIGNMENT',
    emoji: '⚖',
    meterColorClass: 'bg-[#4ea059]',
    valueColorClass: 'text-[#8e6822]',
    actionButtonClass:
      'bg-gradient-to-b from-[#c89955] via-[#b38541] to-[#9c7130] border-[#432c12] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#432c12] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]',
    actionHintClass: 'text-amber-200',
    hotkey: '2',
  },
  composure: {
    label: 'COMPOSURE (CMP)',
    shortLabel: 'CMP',
    actionLabel: 'LATIH COMPOSURE',
    emoji: '🤝',
    dojoEmoji: '💚',
    meterColorClass: 'bg-[#8c5897]',
    valueColorClass: 'text-[#378b4b]',
    actionButtonClass:
      'bg-gradient-to-b from-[#7d9a6a] via-[#6b8858] to-[#597447] border-[#2c3d21] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#2c3d21] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]',
    actionHintClass: 'text-lime-100',
  },
};

/**
 * Broadcast and status copy shared by both headers and the status bar.
 * Every cluster-specific value is passed in from `DistrictTelemetry`, so the
 * shell can never advertise a program id or supply that the configuration does
 * not actually contain.
 */
export const BROADCAST = {
  districtTag: '⚡ LIVE BROADCAST:',
  trainingTag: '⚔ DRILL ACTIVE:',
} as const;

export function districtBroadcastMessage(programShort: string, maxSupply: number): string {
  return (
    `BURN $DIST TO LEVEL UP STATS • PREPARE FOR DOJO TRAINING • ` +
    `PROGRAM ${programShort} • ${maxSupply} CITIZEN SLOTS • SOLANA VERIFIED 🛡`
  );
}

export function trainingBroadcastMessage(): string {
  return (
    `SELECT ANY CITIZEN BELOW • CLICK STAT BUTTON TO TRAIN INT / ALN / CMP • ` +
    `MAX STAT ${MAX_STAT_SCORE} PER CITIZEN • BAS ARCADE VERIFIED 🛡`
  );
}

export function statusBarMessage(programShort: string): string {
  return `◇ DISTRICT ONLINE • PROGRAM: ${programShort} • SOLANA VERIFIED ◇`;
}

/** Static UI labels reused across views. */
export const UI = {
  districtName: 'DISTRICT 01',
  trainingName: 'TRAINING DOJO',
  dojoBadge: 'DOJO SIMULATION',
  backToDistrict: '🏰 KEMBALI KE DISTRICT 01',
  backToDistrictLabel: 'KEMBALI KE DISTRICT 01',
  switchToDojo: '⚔ DOJO',
  burnTokenSymbol: '$DIST',
  registryHeading: 'REGISTRI',
} as const;
