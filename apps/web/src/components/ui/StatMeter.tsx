'use client';

import React from 'react';
import type { StatKey } from '@bas/content';
import { MAX_STAT_SCORE, STAT_METER_SEGMENTS, STAT_META } from '@/config/constants';
import { cn } from '@/lib/utils/cn';

export interface StatMeterProps {
  stat: StatKey;
  value: number;
  /** Emoji shown next to the abbreviation; defaults to the stat icon. */
  emoji?: string | undefined;
  className?: string | undefined;
}

/** Number of blocks to light up for a score of 0..MAX_STAT_SCORE. */
export function statSegments(value: number): number {
  const ratio = Math.max(0, Math.min(MAX_STAT_SCORE, value)) / MAX_STAT_SCORE;
  return Math.min(STAT_METER_SEGMENTS, Math.max(1, Math.round(ratio * STAT_METER_SEGMENTS)));
}

/**
 * Segmented attribute meter used by the agent profile card.
 * Replaces the per-stat markup that was duplicated three times.
 */
export const StatMeter: React.FC<StatMeterProps> = ({ stat, value, emoji, className }) => {
  const meta = STAT_META[stat];
  const filled = statSegments(value);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between font-heading text-xs font-bold text-[#102232]">
        <span className="flex items-center gap-1.5">
          <span className="text-base">{emoji ?? meta.emoji}</span>
          <span>{meta.shortLabel}</span>
        </span>
        <span className="text-sm md:text-base font-bold text-[#102232]">{value}</span>
      </div>

      <div className="mt-1.5 flex w-full items-center gap-1" aria-hidden="true">
        {Array.from({ length: STAT_METER_SEGMENTS }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-3 flex-1 rounded-xs border border-[#182635]',
              index < filled ? meta.meterColorClass : 'bg-[#7e99ab]',
            )}
          />
        ))}
      </div>
    </div>
  );
};
