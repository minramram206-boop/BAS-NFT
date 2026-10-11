import React from 'react';
import type { StatKey } from '@bas/content';
import { MAX_STAT_SCORE, STAT_COLORS, TIER_SCORES } from '@/config/constants';
import { cn } from '@/lib/utils/cn';

export interface StatBarProps {
  stat: StatKey;
  value: number;
  /** `sm` for compact cards, `lg` for the profile. */
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Ten boxes, one per score point, with a dark tick under the Tier 1, 2 and 3
 * boxes so the next threshold is visible at a glance.
 */
export const StatBar: React.FC<StatBarProps> = ({ stat, value, size = 'sm', className }) => (
  <div className={cn('flex gap-[2px]', size === 'lg' && 'gap-[3px]', className)} aria-hidden>
    {Array.from({ length: MAX_STAT_SCORE }, (_, index) => {
      const filled = index < value;
      const tick = (TIER_SCORES as readonly number[]).includes(index + 1);
      return (
        <span
          key={index}
          className={cn(
            'relative block border border-[#1b2a38]',
            size === 'lg' ? 'h-3.5 flex-1' : 'h-3 w-5',
          )}
          style={{ backgroundColor: filled ? STAT_COLORS[stat].fill : '#c3d0dc' }}
        >
          {tick && <span className="absolute -bottom-[7px] -left-px -right-px h-[3px] bg-[#1a2734]" />}
        </span>
      );
    })}
  </div>
);

/** A small square in the stat color, used before stat names. */
export const StatSwatch: React.FC<{ stat: StatKey; className?: string }> = ({ stat, className }) => (
  <span
    className={cn('inline-block h-2.5 w-2.5 shrink-0 border border-[#1b2a38]', className)}
    style={{ backgroundColor: STAT_COLORS[stat].fill }}
    aria-hidden
  />
);
