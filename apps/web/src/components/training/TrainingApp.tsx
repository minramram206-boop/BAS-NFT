'use client';

import React from 'react';
import { TrainingHeaderBar } from '@/components/hud/TrainingHeaderBar';
import { ArcadeShell } from '@/components/layout/ArcadeShell';
import { DistrictStatusBar } from '@/components/layout/DistrictStatusBar';
import { TrainingView } from './TrainingView';

/** Agent Training Dojo screen: arcade shell, dojo header, and the training view. */
export const TrainingApp: React.FC = () => (
  <ArcadeShell
    header={<TrainingHeaderBar />}
    footer={<DistrictStatusBar variant="compact" />}
    bodyClassName="gap-1.5 p-1.5 md:p-2"
  >
    <TrainingView />
  </ArcadeShell>
);
