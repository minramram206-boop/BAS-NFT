'use client';

import React from 'react';
import { AvatarSelectionStrip } from './AvatarSelectionStrip';
import { TrainingDrillActions } from './TrainingDrillActions';
import { TrainingHeroStage } from './TrainingHeroStage';
import { TrainingStatsCard } from './TrainingStatsCard';

/** Agent Training Dojo screen. */
export const TrainingView: React.FC = () => (
  <div className="animate-in fade-in flex min-h-0 w-full flex-1 flex-col gap-2.5 duration-200">
    <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-2.5 md:grid-cols-2">
      <TrainingHeroStage />
      <TrainingStatsCard />
    </div>

    <div className="flex-shrink-0">
      <TrainingDrillActions />
    </div>

    <div className="flex-shrink-0">
      <AvatarSelectionStrip />
    </div>
  </div>
);
