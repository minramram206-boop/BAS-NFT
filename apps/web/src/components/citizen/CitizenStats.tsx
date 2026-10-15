import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { StatBar } from '@/components/ui/StatBar';
import { STAT_COLORS, STAT_ORDER } from '@/config/constants';
import { tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES } from '@/messages';

/** The three stats as one line each: name, bar, score and tier. */
export const CitizenStats: React.FC<{
  citizen: CitizenRecord;
  compact?: boolean;
  /** Name and score on one line, the bar under it, for a narrow column. */
  stacked?: boolean;
  className?: string | undefined;
}> = ({ citizen, compact = false, stacked = false, className }) =>
  stacked ? (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {STAT_ORDER.map((stat) => (
        <div key={stat} className="flex flex-col gap-1 pb-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-heading text-[12px] tracking-wide" style={{ color: STAT_COLORS[stat].fill }}>
              {MESSAGES.stats[stat].shortLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-heading text-[16px] leading-none">{citizen[stat]}</span>
              <span className="rounded bg-[#d3dde6] px-1 font-heading text-[11px] text-[#22354a]">T{tierForScore(citizen[stat])}</span>
            </span>
          </div>
          <StatBar stat={stat} value={citizen[stat]} size="lg" />
        </div>
      ))}
    </div>
  ) : (
  <div className={cn('flex flex-col gap-1.5', className)}>
    {STAT_ORDER.map((stat) => (
      <div key={stat} className="flex items-center gap-1.5">
        <span className="w-[62px] font-heading text-[12px] tracking-wide" style={{ color: STAT_COLORS[stat].fill }}>
          {MESSAGES.stats[stat].shortLabel}
        </span>
        <StatBar stat={stat} value={citizen[stat]} size={compact ? 'sm' : 'lg'} className={compact ? '' : 'flex-1'} />
        <span className="w-6 text-right font-heading text-[15px]">{citizen[stat]}</span>
        <span className="rounded bg-[#d3dde6] px-1 font-heading text-[11px] text-[#22354a]">T{tierForScore(citizen[stat])}</span>
      </div>
    ))}
  </div>
);
