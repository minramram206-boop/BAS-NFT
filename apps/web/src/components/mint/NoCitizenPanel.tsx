'use client';

import React from 'react';
import { WelcomePanel } from '@/components/city/WelcomePanel';

/** Shown where a citizen would act, for a wallet that has not minted one yet. */
export const NoCitizenPanel: React.FC<{ className?: string | undefined }> = ({ className }) => (
  <WelcomePanel className={className} />
);
