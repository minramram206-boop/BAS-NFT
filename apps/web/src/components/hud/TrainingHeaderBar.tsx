'use client';

import React from 'react';
import Link from 'next/link';
import { BROADCAST, UI, trainingBroadcastMessage } from '@/config/constants';
import { useDistrictTelemetry } from '@/components/layout/DistrictTelemetryProvider';
import { ArcadeHeaderBar, HeaderTrailingMeta } from './ArcadeHeaderBar';
import { HeaderBay } from './HeaderBay';
import { HeaderSeam } from './HeaderSeam';

/** Agent Training Dojo header: dojo identity, drill broadcast, and the way back. */
export const TrainingHeaderBar: React.FC = () => {
  const telemetry = useDistrictTelemetry();

  return (
    <ArcadeHeaderBar
      pillLabel={UI.dojoBadge}
      pillDotClassName="bg-amber-500"
      broadcastTag={BROADCAST.trainingTag}
      broadcastMessage={trainingBroadcastMessage()}
      trailing={
        <HeaderTrailingMeta dotClassName="text-amber-600">
          {telemetry.networkLabel}
        </HeaderTrailingMeta>
      }
      start={
        <HeaderBay className="gap-2.5 px-3 md:gap-3 md:px-4">
          <span className="flex h-8 w-7 items-center justify-center rounded-b-lg border-2 border-[#102235] bg-[#234d7d] shadow-[inset_0_1px_0_#6da5df] md:h-9 md:w-8">
            <span className="text-sm font-bold text-white md:text-base">⚔</span>
          </span>
          <span className="whitespace-nowrap font-heading text-sm font-extrabold leading-none tracking-wider text-[#091827] md:text-base lg:text-[17px]">
            {UI.trainingName}
          </span>
        </HeaderBay>
      }
      end={
        <>
          <HeaderSeam />
          <HeaderBay className="gap-2 px-3" seamAfter={false}>
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-lg border-2 border-[#102235] bg-[#244b7a] px-3 py-1 font-heading text-[10px] font-bold text-white shadow-[inset_0_1px_0_#6fa7e4,0_2px_0_#102235] transition-all hover:bg-[#2d5c94] active:translate-y-0.5 md:text-xs"
            >
              <span>🏰</span>
              <span>{UI.backToDistrictLabel}</span>
            </Link>
          </HeaderBay>
        </>
      }
    />
  );
};
