'use client';

import React from 'react';
import type { StatKey } from '@bas/content';
import { MAX_STAT_SCORE, STAT_META } from '@/config/constants';
import { useTrainStat } from '@/stores/selectors';
import { cn } from '@/lib/utils/cn';

export type TrainStatButtonVariant = 'leather' | 'drill';

export interface TrainStatButtonProps {
  stat: StatKey;
  /** `leather` = compact tan button in the agent card, `drill` = large dojo button. */
  variant?: TrainStatButtonVariant | undefined;
  className?: string | undefined;
}

const LEATHER_BUTTON_CLASS =
  'bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] border-2 border-[#2b1a09] ' +
  'shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] active:translate-y-0.5 ' +
  'active:shadow-[inset_0_1.5px_0_#e8cd9c]';

const LABEL_SHADOW_CLASS = 'drop-shadow-[0_1px_1px_rgba(20,10,5,0.95)]';

/**
 * Train one stat of the selected citizen.
 * Replaces the three near-identical buttons that existed in both the agent
 * profile card and the dojo drill row.
 */
export const TrainStatButton: React.FC<TrainStatButtonProps> = ({
  stat,
  variant = 'leather',
  className,
}) => {
  const trainStat = useTrainStat();
  const meta = STAT_META[stat];

  if (variant === 'drill') {
    return (
      <button
        type="button"
        onClick={(event) => trainStat(stat, event.currentTarget)}
        title={`Latih ${meta.shortLabel} (+1 ${meta.shortLabel})`}
        className={cn(
          'group relative flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border-2 px-4 py-3 transition-all active:translate-y-0.5',
          meta.actionButtonClass,
          className,
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/40 bg-white/20 font-heading text-xs font-bold text-white shadow-xs">
          {meta.hotkey ?? meta.emoji}
        </span>
        <span className="flex flex-col items-start leading-none">
          <span
            className={cn(
              'font-heading text-xs font-bold tracking-wide text-white',
              LABEL_SHADOW_CLASS,
            )}
          >
            {meta.emoji} {meta.actionLabel}
          </span>
          <span className={cn('mt-0.5 font-heading text-[9px]', meta.actionHintClass)}>
            +1 {meta.shortLabel} &bull; -1 $DIST
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => trainStat(stat, event.currentTarget)}
      title={`Latih ${meta.shortLabel} (+1 ${meta.shortLabel})`}
      className={cn(
        'group flex cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 transition-all hover:brightness-105 active:translate-y-0.5',
        LEATHER_BUTTON_CLASS,
        className,
      )}
    >
      <span className="text-xs drop-shadow-xs">{meta.emoji}</span>
      <span
        className={cn(
          'pixel-text-outlined font-heading text-[10px] font-bold tracking-wider md:text-[11px]',
          LABEL_SHADOW_CLASS,
        )}
      >
        LATIH {meta.shortLabel}
      </span>
    </button>
  );
};

/** Hint line reused by the dojo stat card and the agent card. */
export const TRAINING_COST_HINT = `Menaikkan stat mengkonsumsi 1 Burn Token $DIST per sesi latihan, maksimum ${MAX_STAT_SCORE} per stat.`;
