'use client';

import React from 'react';
import { useSelectedCitizen } from '@/stores/selectors';
import { AgentProfileCard } from './AgentProfileCard';
import { CitizenRegistryGrid } from './CitizenRegistryGrid';
import { CourtyardPlaza } from './CourtyardPlaza';
import { DialoguePanel } from './DialoguePanel';
import { DistrictActionBar } from './DistrictActionBar';

/**
 * District 01 screen: plaza and dialogue on the left, agent profile and
 * registry on the right. Returns null while the roster is empty.
 */
export const DistrictView: React.FC = () => {
  const citizen = useSelectedCitizen();

  if (!citizen) return null;

  return (
    <div className="animate-in fade-in grid min-h-0 w-full flex-1 grid-cols-1 items-stretch gap-2.5 duration-200 lg:grid-cols-12">
      <div className="flex h-full min-h-0 flex-col justify-between gap-2.5 lg:col-span-5">
        <div className="relative w-full flex-shrink-0">
          <CourtyardPlaza citizen={citizen} />
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col justify-end gap-2.5">
          <DialoguePanel citizen={citizen} />
          <DistrictActionBar />
        </div>
      </div>

      <div className="flex h-full min-h-0 flex-col gap-2 md:gap-2.5 lg:col-span-7">
        <div className="w-full flex-shrink-0">
          <AgentProfileCard citizen={citizen} />
        </div>

        <div className="min-h-0 w-full flex-1">
          <CitizenRegistryGrid />
        </div>
      </div>
    </div>
  );
};
