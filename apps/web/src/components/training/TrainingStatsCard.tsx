'use client';

import React from 'react';
import type { StatKey } from '@bas/content';
import { STAT_META, STAT_ORDER } from '@/config/constants';
import { cn } from '@/lib/utils/cn';
import { useSelectedCitizen } from '@/stores/selectors';
import { TRAINING_COST_HINT } from '@/components/ui/TrainStatButton';

/** Dojo attribute panel: the three trainable stats of the selected citizen. */
export const TrainingStatsCard: React.FC = () => {
  const citizen = useSelectedCitizen();

  if (!citizen) return null;

  return (
    <section className="flex h-full flex-col justify-between gap-3 rounded-xl border-2 border-[#182635] bg-[#bdcddc] p-3.5 shadow-[inset_0_1.5px_0_#fff]">
      <header className="flex items-center justify-between rounded-lg border border-[#142639] bg-[#284a6e] px-3 py-1.5 font-heading text-xs font-bold text-white shadow-[inset_0_1px_0_#5a8cc1]">
        <span className="flex items-center gap-1.5">
          <span className="text-amber-300">★</span>
          <span>AGENT ATTRIBUTES</span>
        </span>
        <span className="text-[10px] text-sky-200">{citizen.code}</span>
      </header>

      <div className="flex flex-col gap-2 rounded-lg border-2 border-[#7e99ab] bg-[#edf5fa] p-2.5 shadow-inner">
        {STAT_ORDER.map((stat, index) => (
          <AttributeRow
            key={stat}
            stat={stat}
            value={citizen[stat]}
            isLast={index === STAT_ORDER.length - 1}
          />
        ))}
      </div>

      <p className="flex items-center gap-2 rounded-lg border border-[#6d542b] bg-[#eedcb9] p-2.5 font-pixel text-[11px] font-semibold leading-snug text-[#4a3315] shadow-xs md:text-xs">
        <span className="text-base">📜</span>
        <span>{TRAINING_COST_HINT}</span>
      </p>
    </section>
  );
};

interface AttributeRowProps {
  stat: StatKey;
  value: number;
  isLast: boolean;
}

const AttributeRow: React.FC<AttributeRowProps> = ({ stat, value, isLast }) => {
  const meta = STAT_META[stat];

  return (
    <div
      className={`flex items-center justify-between ${
        isLast ? '' : 'border-b border-[#c8dbe9] pb-1.5'
      }`}
    >
      <span className="flex items-center gap-2 font-heading text-xs font-bold text-[#102232]">
        <span className="text-sm">{meta.dojoEmoji ?? meta.emoji}</span>
        <span>{meta.label}</span>
      </span>
      <span className={cn('font-heading text-base font-bold', meta.valueColorClass)}>{value}</span>
    </div>
  );
};
