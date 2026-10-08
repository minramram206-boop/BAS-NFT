'use client';

import React from 'react';
import Link from 'next/link';
import { BACK_TO_DISTRICT_HOTKEY, STAT_META, UI } from '@/config/constants';
import { useTrainingHotkeys } from '@/lib/hooks/useTrainingHotkeys';
import { TrainStatButton } from '@/components/ui/TrainStatButton';

/** Stats exposed as a large dojo drill button, in hotkey order. */
const DRILL_STATS = (Object.keys(STAT_META) as Array<keyof typeof STAT_META>).filter(
  (stat) => STAT_META[stat].hotkey !== undefined,
);

const BACK_BUTTON_CLASS =
  'group relative flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border-2 border-[#1a381e] ' +
  'bg-gradient-to-b from-[#69ad6f] via-[#569e5d] to-[#438a49] px-4 py-3 text-center transition-all active:translate-y-0.5 ' +
  'shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#1a381e] active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)]';

const BACK_BADGE_CLASS =
  'flex h-6 w-6 items-center justify-center rounded-md border border-white/40 bg-white/20 font-heading text-xs font-bold text-white shadow-xs';

const BACK_LABEL_CLASS =
  'font-heading text-xs font-bold tracking-wide text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]';

/** Dojo drill row: train a stat with a click or hotkey, or return to the district. */
export const TrainingDrillActions: React.FC = () => {
  useTrainingHotkeys();

  return (
    <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
      {DRILL_STATS.map((stat) => (
        <TrainStatButton key={stat} stat={stat} variant="drill" />
      ))}

      <Link href="/" className={BACK_BUTTON_CLASS} title={UI.backToDistrict}>
        <span className={BACK_BADGE_CLASS}>{BACK_TO_DISTRICT_HOTKEY}</span>
        <span className="flex flex-col items-start leading-none">
          <span className={BACK_LABEL_CLASS}>{UI.backToDistrict}</span>
          <span className="mt-0.5 font-heading text-[9px] text-emerald-100">District 01 Hub</span>
        </span>
      </Link>
    </div>
  );
};
