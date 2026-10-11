'use client';

import React, { useCallback, useState } from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { CityTopBar } from '@/components/layout/TopBar';
import { PixelModal } from '@/components/modal/PixelModal';
import type { CityActivity } from '@/game/CityScene';
import { useMissionProgress, useSelectedCitizenId } from '@/stores/selectors';
import { CityCanvas } from './CityCanvas';
import { MissionTracker } from './MissionTracker';
import { EventCard, ModeToggle, MyCitizens, SelectedCitizenPanel, ZoomControls } from './CityPanels';

/**
 * The city: the Phaser map fills the screen and the panels float above it.
 * The overlay ignores pointer events except on the panels, so the map stays
 * draggable between them.
 */
export const CityScreen: React.FC = () => {
  const selectedId = useSelectedCitizenId();
  const [activity, setActivity] = useState<{ id: number; value: CityActivity } | null>(null);
  const onActivity = useCallback((id: number, value: CityActivity) => setActivity({ id, value }), []);
  const current = activity && activity.id === selectedId ? activity.value : null;
  const progress = useMissionProgress();
  // On a phone the mission card takes the citizen panel's place, so the map stays visible.
  const onMission = Object.values(progress).some((entry) => entry.citizenId === selectedId);

  return (
    <div className="relative h-dvh overflow-hidden bg-[#17262d] font-pixel text-[#1a2734]">
      <CityCanvas onActivity={onActivity} />

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="p-2 md:p-4">
          <CityTopBar />
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="absolute right-2 top-0 flex flex-col items-end gap-2.5 md:right-4">
            <div className="hidden lg:block">
              <EventCard />
            </div>
            <ModeToggle />
            <ZoomControls />
          </div>

          <div className="absolute left-4 top-0 hidden md:block">
            <MissionTracker />
          </div>
          <div className="absolute bottom-4 left-4 hidden lg:block">
            <MyCitizens />
          </div>
          <div className="absolute bottom-4 right-4 hidden md:block">
            <SelectedCitizenPanel activity={current} />
          </div>
          <div className="absolute inset-x-2 bottom-2 flex flex-col gap-2 md:hidden">
            <MissionTracker className="w-full" compact />
            {!onMission && <SelectedCitizenPanel activity={current} compact />}
          </div>
        </div>

        <BottomNav />
      </div>

      <PixelModal />
    </div>
  );
};
