'use client';

import React from 'react';
import { MESSAGES } from '@/messages';
import { useFoundingIds, useSelectCitizen, useSelectedCitizen } from '@/stores/selectors';
import { CitizenSwitcher, SwitcherLabel } from './CitizenSwitcher';

/**
 * One row that says who is playing: the avatar tabs on the left, the chosen
 * citizen on the right. `flat` keeps only the tabs, for a screen that already
 * shows the citizen itself.
 */
export const PlayerStrip: React.FC<{ flat?: boolean }> = ({ flat = false }) => {
  const citizen = useSelectedCitizen();
  const founding = useFoundingIds();
  const select = useSelectCitizen();
  if (!citizen) return null;

  if (flat) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-dashed border-[#9fb3c6] pt-3">
        <SwitcherLabel>{MESSAGES.missions.playingAs}</SwitcherLabel>
        <CitizenSwitcher label={MESSAGES.missions.playingAs} activeId={citizen.id} onPick={select} />
      </div>
    );
  }

  return (
    <section
      aria-label={MESSAGES.missions.playingAs}
      className="bas-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <SwitcherLabel>{MESSAGES.missions.playingAs}</SwitcherLabel>
        <CitizenSwitcher label={MESSAGES.missions.playingAs} activeId={citizen.id} onPick={select} />
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
          <span className="text-[13px] font-medium text-[#33485c]">
            {citizen.code}
            {founding.includes(citizen.id) ? ` · ${MESSAGES.city.foundingCitizen}` : ''}
          </span>
          <span className="truncate font-heading text-[18px] tracking-wide">{citizen.name.toUpperCase()}</span>
          <span className="text-[14px] text-[#22354a]">{citizen.role}</span>
        </div>
        <div className="bas-inset bas-grid-bg flex h-14 w-14 shrink-0 items-center justify-center">
          <img src={citizen.sprite} alt="" width={44} height={44} className="h-11 w-11" />
        </div>
      </div>
    </section>
  );
};
