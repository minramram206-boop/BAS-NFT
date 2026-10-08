'use client';

import React from 'react';
import { DistrictHeaderBar } from '@/components/hud/DistrictHeaderBar';
import { ArcadeShell } from '@/components/layout/ArcadeShell';
import { DistrictStatusBar } from '@/components/layout/DistrictStatusBar';
import { DistrictView } from './DistrictView';

/** District 01 screen: arcade shell, plaza header, and the district view. */
export const DistrictApp: React.FC = () => (
  <ArcadeShell header={<DistrictHeaderBar />} footer={<DistrictStatusBar />}>
    <DistrictView />
  </ArcadeShell>
);
