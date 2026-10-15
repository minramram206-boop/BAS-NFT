'use client';

import React from 'react';
import { NextStepLine } from '@/components/journey/JourneyPanel';
import { PanelTab } from '@/components/ui/PanelTab';
import { Ribbon } from '@/components/ui/Ribbon';
import { StatSwatch } from '@/components/ui/StatBar';
import { STAT_ORDER } from '@/config/constants';
import { statLabel } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES } from '@/messages';
import { useCredits, useFoundingIds, useIsOwned, useSelectCitizen, useSelectedCitizen } from '@/stores/selectors';
import { CitizenStats } from './CitizenStats';
import { CitizenSwitcher, SwitcherLabel } from './CitizenSwitcher';

/**
 * The left column of Missions: who is playing, how they stand, what credits
 * they hold and what to do next. Each part is its own framed section.
 */
export const CitizenRail: React.FC<{
  /** One column at every width, for a narrow sidebar such as the city's. */
  column?: boolean | undefined;
  /** Replaces plain selection, for a screen that also has to move the map. */
  onPick?: ((id: number) => void) | undefined;
  /** A line under the role, such as what the citizen is doing. */
  activity?: React.ReactNode;
  /** Buttons for the bottom of the panel. */
  actions?: React.ReactNode;
  /** Leave the next step out while the mission it points at is shown next to the rail. */
  skipContinue?: boolean | undefined;
}> = ({ column = false, onPick, activity, actions, skipContinue }) => {
  const citizen = useSelectedCitizen();
  const id = citizen?.id ?? -1;
  const owned = useIsOwned(id);
  const credits = useCredits(id);
  const founding = useFoundingIds();
  const select = useSelectCitizen();
  if (!citizen) return null;

  return (
    <section aria-label={MESSAGES.missions.playingAs} className={cn('bas-panel flex flex-col gap-3 p-3', !column && 'md:grid md:grid-cols-2 lg:flex')}>
      <div className="bas-inset flex flex-col gap-2.5 p-3">
        <SwitcherLabel>{MESSAGES.missions.playingAs}</SwitcherLabel>
        <CitizenSwitcher label={MESSAGES.missions.playingAs} activeId={citizen.id} onPick={onPick ?? select} fill />
      </div>

      <div className="bas-inset flex flex-col items-center gap-2 p-3">
        <Ribbon>{citizen.name}</Ribbon>
        <p className="m-0 text-center text-[13px] leading-tight text-[#22354a]">
          {citizen.code}
          {founding.includes(citizen.id) ? ` · ${MESSAGES.city.foundingCitizen}` : ''} · {citizen.role}
        </p>
        {activity && <p className="m-0 text-center text-[13px] leading-snug text-[#33485c]">{activity}</p>}
        <div className="mt-1 flex w-full items-center justify-center gap-4">
          <div className="bas-inset bas-grid-bg flex h-24 w-24 shrink-0 items-center justify-center">
            <img src={citizen.sprite} alt="" width={80} height={80} className="h-20 w-20" />
          </div>
          <CitizenStats citizen={citizen} stacked className={cn('min-w-0 flex-1', column ? 'flex' : 'hidden lg:flex')} />
        </div>
      </div>

      {owned ? (
        <>
          <div className={cn('bas-inset flex-col gap-2.5 p-3', column ? 'flex' : 'hidden lg:flex')}>
            <PanelTab>{MESSAGES.journey.credits}</PanelTab>
            <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
              {STAT_ORDER.map((stat) => (
                <li
                  key={stat}
                  className={cn(
                    'flex min-w-0 flex-col gap-1 rounded-md border-2 border-[#1b2a38] bg-[#e3ecf4] px-2 py-1.5',
                    credits[stat] === 0 && 'opacity-60',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    <StatSwatch stat={stat} />
                    <span className="truncate">{statLabel(stat)}</span>
                  </span>
                  <span className="font-heading text-[20px] leading-none">{credits[stat]}</span>
                </li>
              ))}
            </ul>
          </div>
          <NextStepLine citizen={citizen} stacked skipContinue={skipContinue} className={cn(!column && 'md:col-span-2 lg:col-auto')} />
        </>
      ) : (
        <p className="m-0 rounded-md border-2 border-dashed border-[#5b6b7a] bg-[#d3dde6] p-2 text-[14px] text-[#22354a]">
          {MESSAGES.city.notYours}
        </p>
      )}
      {actions && <div className={cn(!column && 'md:col-span-2 lg:col-auto')}>{actions}</div>}
    </section>
  );
};
