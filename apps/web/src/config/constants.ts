import { MAX_STAT_SCORE, STAT_KEYS } from '@bas/content';
import type { StatKey } from '@bas/content';
import { MESSAGES, formatMessage } from '@/messages';

/**
 * Presentation constants and protocol-adjacent values for the District 01 UI.
 * Public-facing copy lives only in `src/messages/en.json`.
 *
 * This module runs in the browser, so it must not import Node-only packages.
 * Values mirroring the program are verified by `@bas/chain-client` tests.
 */

/** Maximum score of a citizen stat, mirrored from `programs/district`. */
export { MAX_STAT_SCORE };

/** Trainable stats in display order. */
export const STAT_ORDER: readonly StatKey[] = STAT_KEYS;

/** Number of stat blocks rendered by a meter. */
export const STAT_METER_SEGMENTS = 5;

/** Citizens displayed per registry page (3x3 grid). */
export const REGISTRY_PAGE_SIZE = 9;

/** DOM id of the registry section, used by the browse-citizens action. */
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

/** Key that returns from training to the district. */
export const BACK_TO_DISTRICT_HOTKEY = 'Escape';
export const BACK_TO_DISTRICT_HOTKEY_LABEL = MESSAGES.training.backHotkeyLabel;

export interface StatMeta {
  /** Public English label; never expose the internal stat key. */
  label: string;
  /** Public English text used in compact badges. */
  shortLabel: string;
  /** English title of the training action. */
  actionLabel: string;
  emoji: string;
  dojoEmoji?: string | undefined;
  meterColorClass: string;
  valueColorClass: string;
  actionButtonClass: string;
  actionHintClass: string;
  hotkey?: string | undefined;
}

export const STAT_META: Record<StatKey, StatMeta> = {
  intelligence: {
    ...MESSAGES.stats.intelligence,
    meterColorClass: 'bg-[#3c76ad]',
    valueColorClass: 'text-[#286396]',
    actionButtonClass:
      'bg-gradient-to-b from-[#5588b9] via-[#4374a3] to-[#33618d] border-[#183248] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#183248] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]',
    actionHintClass: 'text-sky-200',
  },
  alignment: {
    ...MESSAGES.stats.alignment,
    meterColorClass: 'bg-[#4ea059]',
    valueColorClass: 'text-[#8e6822]',
    actionButtonClass:
      'bg-gradient-to-b from-[#c89955] via-[#b38541] to-[#9c7130] border-[#432c12] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#432c12] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]',
    actionHintClass: 'text-amber-200',
  },
  compute: {
    ...MESSAGES.stats.compute,
    meterColorClass: 'bg-[#8c5897]',
    valueColorClass: 'text-[#378b4b]',
    actionButtonClass:
      'bg-gradient-to-b from-[#7d9a6a] via-[#6b8858] to-[#597447] border-[#2c3d21] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#2c3d21] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]',
    actionHintClass: 'text-lime-100',
  },
};

/** Broadcast labels supplied from the canonical English message catalog. */
export const BROADCAST = {
  districtTag: MESSAGES.broadcast.districtTag,
  trainingTag: MESSAGES.broadcast.trainingTag,
} as const;

export function districtBroadcastMessage(
  active: number,
  maxSupply: number,
  network: string,
): string {
  return formatMessage(MESSAGES.broadcast.districtMessage, {
    active,
    supply: maxSupply,
    network,
  });
}

export function trainingBroadcastMessage(): string {
  return formatMessage(MESSAGES.broadcast.trainingMessage, { maxScore: MAX_STAT_SCORE });
}

export function statusBarMessage(network: string, programShort: string): string {
  return formatMessage(MESSAGES.status.previewNotice, {
    network,
    program: programShort,
  });
}

/** Static UI labels reused across views. */
export const UI = {
  districtName: MESSAGES.app.districtName,
  trainingName: MESSAGES.app.trainingName,
  dojoBadge: MESSAGES.app.trainingBadge,
  backToDistrict: MESSAGES.app.backToDistrict,
  backToDistrictLabel: MESSAGES.app.backToDistrict,
  districtHub: MESSAGES.app.districtHub,
  burnTokenSymbol: MESSAGES.app.burnTokenSymbol,
  registryHeading: MESSAGES.app.registryHeading,
} as const;
