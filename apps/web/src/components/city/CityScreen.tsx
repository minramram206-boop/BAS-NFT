'use client';

import React, { useCallback, useState } from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { CityTopBar } from '@/components/layout/TopBar';
import { MarketNotices } from '@/components/market/MarketNotices';
import { MissionRewardDialog } from '@/components/modal/MissionRewardDialog';
import { PixelModal } from '@/components/modal/PixelModal';
import type { CityActivity } from '@/game/CityScene';
import { MESSAGES } from '@/messages';
import { useMissionProgress, useOwnedIds, useSelectedCitizenId } from '@/stores/selectors';
import { CityCanvas } from './CityCanvas';
import { MissionPopup } from './MissionPopup';
import { MissionTracker } from './MissionTracker';
import { EventCard, ModeToggle, SelectedCitizenPanel, ZoomControls } from './CityPanels';

/**
 * The city. From tablet width up the screen is a top bar, a sidebar with
 * everything about the citizens, and the map in its own frame, so no panel
 * covers the map. On a phone the map fills the screen and the cards float over it.
 */
export const CityScreen: React.FC = () => {
  const selectedId = useSelectedCitizenId();
  const [activity, setActivity] = useState<{ id: number; value: CityActivity } | null>(null);
  const onActivity = useCallback((id: number, value: CityActivity) => setActivity({ id, value }), []);
  const current = activity && activity.id === selectedId ? activity.value : null;
  const progress = useMissionProgress();
  // On a phone the mission card takes the citizen card's place, so the map stays visible.
  const owned = useOwnedIds();
  const onMission = owned.includes(selectedId) && Object.values(progress).some((entry) => entry.citizenId === selectedId);

  return (
    <div className="relative h-dvh overflow-hidden bg-[#17262d] font-pixel text-[#1a2734] md:grid md:grid-cols-[336px_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[376px_minmax(0,1fr)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-2 md:pointer-events-auto md:static md:z-auto md:col-span-2 md:p-4 md:pb-3">
        <CityTopBar />
      </div>

      <aside
        aria-label={MESSAGES.city.sidebar}
        className="hidden min-h-0 flex-col gap-3 overflow-y-auto pb-4 pl-4 pr-2 pt-0.5 [scrollbar-width:thin] md:flex"
      >
        <MissionTracker className="w-full" />
        <SelectedCitizenPanel activity={current} />
      </aside>

      <div className="absolute inset-0 md:relative md:inset-auto md:mb-4 md:mr-4 md:overflow-hidden md:rounded-lg md:border-2 md:border-[#1b2a38] md:shadow-[0_4px_0_#0b141c]">
        <CityCanvas onActivity={onActivity} />
        <div className="pointer-events-none absolute left-3 top-3 hidden lg:block">
          <EventCard />
        </div>
        <div className="pointer-events-none absolute right-2 top-[72px] flex flex-col items-end gap-2.5 md:right-3 md:top-3">
          {owned.length > 0 && <ModeToggle />}
          <ZoomControls />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col md:hidden">
        <div className="flex flex-col gap-2 p-2">
          <MissionTracker className="w-full" compact />
          {!onMission && <SelectedCitizenPanel activity={current} compact />}
        </div>
        <BottomNav />
      </div>

      <MissionPopup />
      <MissionRewardDialog />
      <PixelModal />
      <MarketNotices />
    </div>
  );
};
